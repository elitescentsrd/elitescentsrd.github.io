// Cuentas, sesiones, créditos y suscripciones de Opaco.
//
// En esta versión todo se guarda en el almacenamiento local del navegador (localStorage): las contraseñas nunca se
// guardan en claro (PBKDF2-SHA-256 con sal aleatoria y 210.000 iteraciones), la sesión caduca y cada crédito gastado
// queda anotado. Los pagos son SIMULADOS: no se pide ninguna tarjeta ni se cobra nada.
// Todas las funciones son asíncronas y devuelven los mismos datos que devolvería un servidor, para que sustituir este
// archivo por llamadas a una API real no obligue a tocar el resto de la web.

const DB_KEY = 'opaco:v1';
const SESSION_KEY = 'opaco:session';
const SESSION_DAYS = 14;
const ITERATIONS = 210000;

export const PLANS = {
  gratis: { id: 'gratis', name: 'Gratuito', price: 0, credits: 5, monthly: false, blurb: 'Para probar Opaco con tus propios documentos.' },
  profesional: { id: 'profesional', name: 'Profesional', price: 19, credits: 200, monthly: true, blurb: 'Para gestorías y despachos pequeños.' },
  empresa: { id: 'empresa', name: 'Empresa', price: 59, credits: 1000, monthly: true, blurb: 'Para departamentos con volumen alto.' },
};
const RANK = { gratis: 0, profesional: 1, empresa: 2 };

export const DEMO = { email: 'prueba@opaco.demo', password: 'PruebaOpaco-2026', name: 'Cuenta de prueba', company: 'Gestoría de demostración' };

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------------------------------------------------------------- almacenamiento
let memory = null; // si el navegador bloquea localStorage (modo privado estricto), los datos viven solo en esta pestaña
function storageOk() { try { localStorage.setItem('opaco:t', '1'); localStorage.removeItem('opaco:t'); return true; } catch { return false; } }
const persistent = storageOk();
export const isPersistent = () => persistent;

function load() {
  if (!persistent) return memory || (memory = { users: [], sessions: {}, attempts: {} });
  try { const db = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); if (db && Array.isArray(db.users)) return db; } catch { /* datos dañados: se empieza de cero */ }
  return { users: [], sessions: {}, attempts: {} };
}
function save(db) {
  if (!persistent) { memory = db; return; }
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  window.dispatchEvent(new CustomEvent('opaco:change'));
}
function sessionToken() { try { return persistent ? localStorage.getItem(SESSION_KEY) : memory?._token; } catch { return null; } }
function setSessionToken(t) { if (persistent) { t ? localStorage.setItem(SESSION_KEY, t) : localStorage.removeItem(SESSION_KEY); } else if (memory) memory._token = t; }

// ---------------------------------------------------------------- utilidades
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const id = prefix => prefix + '_' + randomHex(8);
async function hashPassword(password, saltHex, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
function sameHash(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const normEmail = e => String(e || '').trim().toLowerCase();
const addMonth = ts => { const d = new Date(ts); d.setMonth(d.getMonth() + 1); return d.getTime(); };

export function passwordProblems(pw, email = '') {
  const p = [];
  if (pw.length < 10) p.push('al menos 10 caracteres');
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) p.push('letras y números');
  if (email && pw.toLowerCase().includes(normEmail(email).split('@')[0]) && normEmail(email).split('@')[0].length > 3) p.push('que no contenga tu correo');
  return p;
}

function publicUser(u) {
  const plan = PLANS[u.plan];
  return {
    id: u.id, email: u.email, name: u.name, company: u.company, createdAt: u.createdAt,
    plan: u.plan, planName: plan.name, allotment: plan.credits, credits: u.credits,
    periodStart: u.periodStart, periodEnd: u.periodEnd, cancelAtPeriodEnd: !!u.cancelAtPeriodEnd, pendingPlan: u.pendingPlan || null,
    usage: [...u.usage].reverse(), invoices: [...u.invoices].reverse(), isDemo: u.email === DEMO.email,
    low: u.credits > 0 && u.credits <= Math.max(1, Math.ceil(plan.credits * 0.2)), empty: u.credits <= 0,
  };
}

function newUser({ email, name, company, salt, hash }) {
  return { id: id('usr'), email, name, company, salt, hash, iterations: ITERATIONS, createdAt: Date.now(), plan: 'gratis', credits: PLANS.gratis.credits, periodStart: Date.now(), periodEnd: null, cancelAtPeriodEnd: false, pendingPlan: null, usage: [], invoices: [] };
}

// Renovaciones mensuales pendientes (se aplican al leer la cuenta, igual que haría el servidor con su tarea programada).
function rollover(u, now = Date.now()) {
  let changed = false;
  while (PLANS[u.plan].monthly && u.periodEnd && now >= u.periodEnd) {
    changed = true;
    const start = u.periodEnd;
    if (u.cancelAtPeriodEnd) {
      Object.assign(u, { plan: 'gratis', credits: 0, periodStart: start, periodEnd: null, cancelAtPeriodEnd: false, pendingPlan: null });
      u.usage.push({ id: id('mov'), date: start, kind: 'plan', text: 'Suscripción cancelada: pasas al plan Gratuito', credits: 0 });
      break;
    }
    if (u.pendingPlan) { u.plan = u.pendingPlan; u.pendingPlan = null; }
    const plan = PLANS[u.plan];
    u.credits = plan.credits; u.periodStart = start; u.periodEnd = addMonth(start);
    u.invoices.push(invoice(plan, start, 'Renovación mensual'));
    u.usage.push({ id: id('mov'), date: start, kind: 'renovacion', text: 'Renovación del plan ' + plan.name + ': créditos repuestos', credits: plan.credits });
  }
  return changed;
}
function invoice(plan, date, concept) {
  const n = new Date(date);
  return { id: 'SIM-' + n.getFullYear() + String(n.getMonth() + 1).padStart(2, '0') + '-' + randomHex(3).toUpperCase(), date, plan: plan.id, planName: plan.name, concept, amount: plan.price, status: 'Simulada: no se ha cobrado nada' };
}

function withUser(fn, write = true) {
  const db = load();
  const s = db.sessions[sessionToken() || ''];
  if (!s || s.expires < Date.now()) throw new ApiError('auth', 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
  const u = db.users.find(x => x.id === s.userId);
  if (!u) throw new ApiError('auth', 'La cuenta ya no existe.');
  const changed = rollover(u);
  const result = fn(u, db);
  if (changed || write) save(db);
  return result;
}

// ---------------------------------------------------------------- cuenta de prueba
let demoReady = null;
export function ensureDemo() {
  return demoReady || (demoReady = (async () => {
    if (load().users.some(u => u.email === DEMO.email)) return;
    const salt = randomHex(16);
    const hash = await hashPassword(DEMO.password, salt);
    const db = load(); // se vuelve a leer: mientras se calculaba la huella, otra pestaña pudo cambiar los datos
    if (db.users.some(u => u.email === DEMO.email)) return;
    db.users.push(newUser({ email: DEMO.email, name: DEMO.name, company: DEMO.company, salt, hash }));
    save(db);
  })());
}

// ---------------------------------------------------------------- API pública
export async function register({ name, company, email, password, accept }) {
  await ensureDemo();
  email = normEmail(email); name = String(name || '').trim(); company = String(company || '').trim();
  if (!name) throw new ApiError('name', 'Escribe tu nombre.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError('email', 'El correo no parece válido.');
  const problems = passwordProblems(password, email);
  if (problems.length) throw new ApiError('password', 'La contraseña necesita ' + problems.join(', ') + '.');
  if (!accept) throw new ApiError('accept', 'Debes aceptar los términos y la política de privacidad.');
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const db = load();
  if (db.users.some(u => u.email === email)) throw new ApiError('exists', 'Ya existe una cuenta con ese correo. Inicia sesión.');
  const u = newUser({ email, name, company, salt, hash });
  u.usage.push({ id: id('mov'), date: Date.now(), kind: 'alta', text: 'Alta en el plan Gratuito', credits: PLANS.gratis.credits });
  db.users.push(u);
  startSession(db, u);
  save(db);
  return publicUser(u);
}

function startSession(db, u) {
  const token = randomHex(24);
  for (const [t, s] of Object.entries(db.sessions)) if (s.expires < Date.now()) delete db.sessions[t];
  db.sessions[token] = { userId: u.id, expires: Date.now() + SESSION_DAYS * 864e5 };
  setSessionToken(token);
}

export async function login(email, password) {
  await ensureDemo();
  email = normEmail(email);
  const db = load();
  const a = db.attempts[email] || { n: 0, until: 0 };
  if (a.until > Date.now()) throw new ApiError('locked', 'Demasiados intentos fallidos. Espera ' + Math.ceil((a.until - Date.now()) / 60000) + ' min y vuelve a probar.');
  const u = db.users.find(x => x.email === email);
  const ok = u && sameHash(await hashPassword(password, u.salt, u.iterations), u.hash);
  const fresh = load();
  if (!ok) {
    const at = fresh.attempts[email] || { n: 0, until: 0 };
    at.n += 1; if (at.n >= 5) { at.until = Date.now() + 5 * 60000; at.n = 0; }
    fresh.attempts[email] = at; save(fresh);
    throw new ApiError('credentials', 'Correo o contraseña incorrectos.');
  }
  delete fresh.attempts[email];
  const fu = fresh.users.find(x => x.id === u.id);
  rollover(fu);
  startSession(fresh, fu);
  save(fresh);
  return publicUser(fu);
}

export async function logout() {
  const db = load();
  delete db.sessions[sessionToken() || ''];
  setSessionToken(null);
  save(db);
}

export async function me() {
  await ensureDemo();
  try { return withUser(u => publicUser(u), false); } catch (e) { if (e.code === 'auth') return null; throw e; }
}

// Gasta créditos antes de procesar un documento. Si algo falla después, refund() los devuelve.
export async function consume(pages, label) {
  return withUser(u => {
    if (!Number.isInteger(pages) || pages < 1) throw new ApiError('pages', 'Número de páginas no válido.');
    if (u.credits < pages) throw new ApiError('credits', u.credits <= 0 ? 'Te has quedado sin créditos.' : 'Este documento necesita ' + pages + ' créditos y te quedan ' + u.credits + '.');
    u.credits -= pages;
    const mov = { id: id('mov'), date: Date.now(), kind: 'uso', text: label || ('Documento de ' + pages + (pages === 1 ? ' página' : ' páginas')), credits: -pages };
    u.usage.push(mov);
    return { movement: mov.id, user: publicUser(u) };
  });
}

export async function refund(movementId) {
  return withUser(u => {
    const mov = u.usage.find(m => m.id === movementId && m.kind === 'uso' && !m.refunded);
    if (!mov) return publicUser(u);
    mov.refunded = true; u.credits += -mov.credits;
    u.usage.push({ id: id('mov'), date: Date.now(), kind: 'devolucion', text: 'Devolución: no se pudo procesar el documento', credits: -mov.credits });
    return publicUser(u);
  });
}

// Pago simulado: cambia de plan al instante (mejora) o al final del periodo (bajada).
export async function checkout(planId) {
  if (!PLANS[planId] || planId === 'gratis') throw new ApiError('plan', 'Plan no válido.');
  await new Promise(r => setTimeout(r, 900)); // simula la pasarela de pago
  return withUser(u => {
    const plan = PLANS[planId];
    if (u.plan === planId && !u.cancelAtPeriodEnd && !u.pendingPlan) throw new ApiError('same', 'Ya tienes el plan ' + plan.name + '.');
    if (RANK[planId] < RANK[u.plan]) {
      u.pendingPlan = planId; u.cancelAtPeriodEnd = false;
      u.usage.push({ id: id('mov'), date: Date.now(), kind: 'plan', text: 'Cambio al plan ' + plan.name + ' programado para el ' + new Date(u.periodEnd).toLocaleDateString('es-ES'), credits: 0 });
      return { user: publicUser(u), scheduled: true };
    }
    if (u.plan === planId) { u.cancelAtPeriodEnd = false; u.pendingPlan = null; return { user: publicUser(u), resumed: true }; }
    const now = Date.now();
    Object.assign(u, { plan: planId, credits: plan.credits, periodStart: now, periodEnd: addMonth(now), cancelAtPeriodEnd: false, pendingPlan: null });
    const inv = invoice(plan, now, 'Alta en el plan ' + plan.name);
    u.invoices.push(inv);
    u.usage.push({ id: id('mov'), date: now, kind: 'plan', text: 'Mejora al plan ' + plan.name + ' (pago simulado)', credits: plan.credits });
    return { user: publicUser(u), invoice: inv };
  });
}

export async function cancelSubscription() {
  return withUser(u => {
    if (!PLANS[u.plan].monthly) throw new ApiError('plan', 'No tienes ninguna suscripción activa.');
    u.cancelAtPeriodEnd = true; u.pendingPlan = null;
    u.usage.push({ id: id('mov'), date: Date.now(), kind: 'plan', text: 'Suscripción cancelada: sigue activa hasta el ' + new Date(u.periodEnd).toLocaleDateString('es-ES'), credits: 0 });
    return publicUser(u);
  });
}

export async function resumeSubscription() {
  return withUser(u => { u.cancelAtPeriodEnd = false; u.pendingPlan = null; return publicUser(u); });
}

// Herramienta de demostración: adelanta el reloj hasta el final del periodo actual para ver la renovación.
export async function simulateRenewal() {
  return withUser(u => {
    if (!PLANS[u.plan].monthly) throw new ApiError('plan', 'El plan Gratuito no se renueva: sus 5 créditos son de prueba.');
    u.periodEnd = Date.now() - 1;
    rollover(u);
    return publicUser(u);
  });
}

export async function updateProfile({ name, company }) {
  name = String(name || '').trim();
  if (!name) throw new ApiError('name', 'Escribe tu nombre.');
  return withUser(u => { u.name = name; u.company = String(company || '').trim(); return publicUser(u); });
}

export async function changePassword(current, next) {
  const u0 = await me();
  if (!u0) throw new ApiError('auth', 'Tu sesión ha caducado.');
  const db = load();
  const u = db.users.find(x => x.id === u0.id);
  if (!sameHash(await hashPassword(current, u.salt, u.iterations), u.hash)) throw new ApiError('credentials', 'La contraseña actual no es correcta.');
  const problems = passwordProblems(next, u.email);
  if (problems.length) throw new ApiError('password', 'La nueva contraseña necesita ' + problems.join(', ') + '.');
  const salt = randomHex(16);
  const hash = await hashPassword(next, salt);
  return withUser(x => { x.salt = salt; x.hash = hash; x.iterations = ITERATIONS; return publicUser(x); });
}

export async function deleteAccount(password) {
  const u0 = await me();
  if (!u0) throw new ApiError('auth', 'Tu sesión ha caducado.');
  const db = load();
  const u = db.users.find(x => x.id === u0.id);
  if (!sameHash(await hashPassword(password, u.salt, u.iterations), u.hash)) throw new ApiError('credentials', 'La contraseña no es correcta.');
  db.users = db.users.filter(x => x.id !== u.id);
  for (const [t, s] of Object.entries(db.sessions)) if (s.userId === u.id) delete db.sessions[t];
  setSessionToken(null);
  save(db);
  if (u.email === DEMO.email) demoReady = null;
}

// Deja la cuenta de prueba como recién creada (plan Gratuito con 5 créditos) para repetir el recorrido completo.
export async function resetDemo() {
  const u0 = await me();
  if (!u0 || !u0.isDemo) throw new ApiError('demo', 'Solo la cuenta de prueba se puede restablecer.');
  return withUser(u => {
    Object.assign(u, { plan: 'gratis', credits: PLANS.gratis.credits, periodStart: Date.now(), periodEnd: null, cancelAtPeriodEnd: false, pendingPlan: null, usage: [], invoices: [], name: DEMO.name, company: DEMO.company });
    return publicUser(u);
  });
}
