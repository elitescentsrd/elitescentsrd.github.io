// Piezas compartidas por todas las páginas: estado de sesión en la cabecera, contador de créditos, menú y avisos.
import { me, logout, PLANS } from './api.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
export const fmtDateTime = ts => new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtEuro = n => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: n % 1 ? 2 : 0 });
// Miles con punto también en números de 4 cifras ("1.000"), que Intl deja sin agrupar en español.
export const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

let toastTimer;
export function toast(message) {
  let t = $('#toast');
  if (!t) { t = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = message; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

export function creditState(user) {
  const pct = user.allotment ? Math.max(0, Math.min(100, (user.credits / user.allotment) * 100)) : 0;
  return { pct, cls: user.empty ? 'empty' : user.low ? 'low' : '' };
}

// Rellena la cabecera según haya sesión o no (elementos con data-auth="in"/"out", data-user="name|email|credits|plan").
export async function initHeader() {
  const user = await me();
  $$('[data-auth="in"]').forEach(n => { n.hidden = !user; });
  $$('[data-auth="out"]').forEach(n => { n.hidden = !!user; });
  if (user) paintUser(user);
  const menuBtn = $('#menuButton'), menu = $('#menuList');
  if (menuBtn && menu && !menuBtn.dataset.ready) {
    menuBtn.dataset.ready = '1';
    menuBtn.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.focus(); } });
  }
  $$('[data-action="logout"]').forEach(b => b.addEventListener('click', async () => { await logout(); location.href = 'acceso.html?salida=1'; }));
  return user;
}

export function paintUser(user) {
  $$('[data-user="name"]').forEach(n => { n.textContent = user.name; });
  $$('[data-user="email"]').forEach(n => { n.textContent = user.email; });
  $$('[data-user="plan"]').forEach(n => { n.textContent = PLANS[user.plan].name; });
  $$('[data-user="credits"]').forEach(n => { n.textContent = fmtInt(user.credits); });
  $$('[data-user="allotment"]').forEach(n => { n.textContent = fmtInt(user.allotment); });
  const { pct, cls } = creditState(user);
  $$('[data-user="meter"]').forEach(m => { m.className = 'meter ' + cls; m.firstElementChild.style.width = pct + '%'; });
  $$('[data-user="pill"]').forEach(p => p.setAttribute('aria-label', 'Créditos: ' + user.credits + ' de ' + user.allotment + '. Ver mi cuenta.'));
}

// Páginas privadas: sin sesión se va a la de acceso y se vuelve aquí después.
export async function requireUser() {
  const user = await initHeader();
  if (!user) { location.replace('acceso.html?siguiente=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)); return new Promise(() => {}); }
  return user;
}

// Aviso de créditos (bajo o agotado). Devuelve el nodo o null si no hace falta.
export function creditAlert(user) {
  if (!user.low && !user.empty) return null;
  const upgrade = user.plan === 'empresa' ? null : el('a', { class: 'btn btn-primary btn-sm', href: 'pago.html?plan=' + (user.plan === 'gratis' ? 'profesional' : 'empresa') }, 'Mejorar plan');
  const renew = PLANS[user.plan].monthly && user.periodEnd ? ' Tus créditos se renuevan el ' + fmtDate(user.periodEnd) + '.' : '';
  if (user.empty) return el('div', { class: 'alert alert-danger', role: 'alert' }, el('p', {}, el('strong', {}, 'Te has quedado sin créditos. '), 'Para seguir anonimizando documentos, mejora tu plan.' + renew), upgrade);
  return el('div', { class: 'alert alert-warn', role: 'status' }, el('p', {}, el('strong', {}, 'Te quedan pocos créditos: ' + plural(user.credits, 'página', 'páginas') + '. '), user.plan === 'empresa' ? renew.trim() : 'Mejora tu plan para no quedarte a medias.' + renew), upgrade);
}

// Cambios hechos en otra pestaña (por ejemplo, gastar créditos) se reflejan aquí.
export function onAccountChange(fn) {
  window.addEventListener('storage', e => { if (e.key && e.key.startsWith('opaco:')) fn(); });
  window.addEventListener('opaco:change', fn);
}
