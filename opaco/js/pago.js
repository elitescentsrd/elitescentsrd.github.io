// Planes y pago SIMULADO: no hay pasarela real, no se piden datos de tarjeta y no se cobra nada.
import { PLANS, checkout } from './api.js';
import { $, el, fmtInt, requireUser, paintUser, fmtEuro, fmtDate } from './common.js';

let user = await requireUser();
const RANK = { gratis: 0, profesional: 1, empresa: 2 };
let chosen = new URLSearchParams(location.search).get('plan');
if (!PLANS[chosen] || chosen === 'gratis') chosen = null;

function planCard(p) {
  const current = user.plan === p.id;
  const featured = p.id === 'profesional';
  let action;
  if (current && !user.cancelAtPeriodEnd) action = el('button', { class: 'btn btn-ghost btn-block', disabled: true }, 'Tu plan actual');
  else if (p.id === 'gratis') action = el('p', { class: 'muted small' }, user.plan === 'gratis' ? 'Tu plan actual.' : 'Para volver al plan Gratuito, cancela la suscripción en Mi cuenta.');
  else action = el('button', { class: 'btn ' + (featured || chosen === p.id ? 'btn-primary' : 'btn-ghost') + ' btn-block', onclick: () => choose(p.id) },
    current ? 'Reactivar ' + p.name : RANK[p.id] > RANK[user.plan] ? 'Mejorar a ' + p.name : 'Cambiar a ' + p.name);
  return el('article', { class: 'plan' + (featured ? ' featured' : '') + (current ? ' current' : '') },
    el('h3', {}, p.name), el('p', { class: 'muted small' }, p.blurb),
    el('p', { class: 'price' }, fmtEuro(p.price) + ' ', p.monthly ? el('small', {}, '/ mes') : ''),
    el('p', { class: 'credits' }, p.monthly ? fmtInt(p.credits) + ' créditos al mes' : '5 créditos de prueba'),
    el('ul', {}, el('li', {}, 'Todas las categorías de datos'), el('li', {}, 'PDF digitales y escaneados'), el('li', {}, p.monthly ? 'Cancela cuando quieras' : 'Sin tarjeta')),
    action);
}

function render() {
  paintUser(user);
  $('#plans').replaceChildren(...Object.values(PLANS).map(planCard));
  const box = $('#checkout');
  box.hidden = !chosen;
  if (!chosen) return;
  const p = PLANS[chosen];
  const downgrade = RANK[chosen] < RANK[user.plan];
  $('#summary').replaceChildren(
    el('div', { class: 'summary-line' }, el('span', {}, 'Plan ' + p.name), el('span', {}, fmtEuro(p.price) + ' / mes')),
    el('div', { class: 'summary-line' }, el('span', {}, 'Créditos'), el('span', {}, fmtInt(p.credits) + ' al mes')),
    el('div', { class: 'summary-line' }, el('span', {}, downgrade ? 'Empieza' : 'Hoy'), el('span', {}, downgrade ? fmtDate(user.periodEnd) : fmtDate(Date.now()))),
    el('div', { class: 'summary-line total' }, el('span', {}, 'Se cobra ahora'), el('span', {}, '0 € (simulado)')));
  $('#summaryNote').textContent = downgrade
    ? 'Bajar de plan se aplica al final del periodo actual: hasta el ' + fmtDate(user.periodEnd) + ' conservas el plan ' + PLANS[user.plan].name + ' y sus créditos.'
    : 'Al activarlo tendrás ' + fmtInt(p.credits) + ' créditos desde este momento y la renovación será el mismo día de cada mes. En un servicio real se cobrarían ' + fmtEuro(p.price) + ' al mes.';
  $('#payButton').textContent = downgrade ? 'Programar el cambio (simulación)' : 'Confirmar (simulación, 0 €)';
}

function choose(id) {
  chosen = id;
  history.replaceState(null, '', '?plan=' + id);
  render();
  $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#payButton').focus({ preventScroll: true });
}

$('#payButton').addEventListener('click', async () => {
  const btn = $('#payButton'), status = $('#payStatus');
  btn.disabled = true; status.className = 'form-status'; status.textContent = 'Procesando el pago simulado…';
  try {
    const r = await checkout(chosen);
    user = r.user;
    location.replace('cuenta.html?pago=' + (r.scheduled ? 'programado' : 'ok'));
  } catch (err) { status.className = 'form-status error'; status.textContent = err.message; btn.disabled = false; }
});

render();
