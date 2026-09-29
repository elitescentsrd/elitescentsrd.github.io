// Mi cuenta: créditos, plan, movimientos, facturas simuladas y ajustes.
import { me, PLANS, cancelSubscription, resumeSubscription, simulateRenewal, resetDemo, updateProfile, changePassword, deleteAccount } from './api.js';
import { $, el, fmtInt, requireUser, paintUser, creditAlert, fmtDate, fmtDateTime, fmtEuro, onAccountChange, toast } from './common.js';

let user = await requireUser();

function render() {
  paintUser(user);
  const alerts = $('#alerts'); alerts.replaceChildren();
  const a = creditAlert(user); if (a) alerts.append(a);
  const q = new URLSearchParams(location.search);
  if (q.get('pago') === 'ok') alerts.prepend(el('div', { class: 'alert alert-ok', role: 'status' }, el('p', {}, el('strong', {}, 'Plan ' + PLANS[user.plan].name + ' activado. '), 'Pago simulado: no se ha cobrado nada. Ya tienes ' + user.credits + ' créditos.')));
  if (q.get('pago') === 'programado') alerts.prepend(el('div', { class: 'alert alert-info', role: 'status' }, el('p', {}, 'El cambio al plan ' + PLANS[user.pendingPlan || user.plan].name + ' se aplicará el ' + fmtDate(user.periodEnd) + '. Hasta entonces conservas tu plan actual.')));

  const plan = PLANS[user.plan];
  $('#creditsNote').textContent = plan.monthly
    ? 'Los créditos se renuevan el ' + fmtDate(user.periodEnd) + ' (' + fmtInt(plan.credits) + ' al mes, no se acumulan).'
    : user.credits > 0 ? 'Créditos de prueba del plan Gratuito. No se renuevan.' : 'Has usado los créditos de prueba. Contrata un plan para seguir.';

  $('#planBadge').textContent = plan.name;
  $('#planBadge').className = 'badge ' + (plan.monthly ? 'badge-ok' : '');
  const rows = [['Plan', plan.name], ['Precio', plan.price ? fmtEuro(plan.price) + ' / mes' : 'Gratis'], ['Créditos', plan.monthly ? fmtInt(plan.credits) + ' al mes' : '5 de prueba']];
  if (plan.monthly) rows.push([user.cancelAtPeriodEnd ? 'Termina el' : 'Próxima renovación', fmtDate(user.periodEnd)]);
  if (user.pendingPlan) rows.push(['Cambio programado', 'Plan ' + PLANS[user.pendingPlan].name + ' desde el ' + fmtDate(user.periodEnd)]);
  if (user.cancelAtPeriodEnd) rows.push(['Estado', 'Cancelada: pasarás al plan Gratuito']);
  $('#planInfo').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

  const actions = $('#planActions'); actions.replaceChildren();
  if (user.plan !== 'empresa') actions.append(el('a', { class: 'btn btn-primary btn-sm', href: 'pago.html?plan=' + (user.plan === 'gratis' ? 'profesional' : 'empresa') }, 'Mejorar plan'));
  actions.append(el('a', { class: 'btn btn-ghost btn-sm', href: 'pago.html' }, 'Ver todos los planes'));
  if (plan.monthly && !user.cancelAtPeriodEnd) actions.append(el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: onCancel }, 'Cancelar suscripción'));
  if (user.cancelAtPeriodEnd || user.pendingPlan) actions.append(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: onResume }, user.cancelAtPeriodEnd ? 'Reactivar suscripción' : 'Anular el cambio de plan'));

  $('#usage').replaceChildren(...(user.usage.length ? user.usage.slice(0, 50).map(m => el('tr', {},
    el('td', {}, fmtDateTime(m.date)), el('td', {}, m.text),
    el('td', { class: 'num ' + (m.credits > 0 ? 'plus' : 'minus') }, m.credits ? (m.credits > 0 ? '+' : '−') + Math.abs(m.credits) : '—'))) : [el('tr', {}, el('td', { colspan: 3, class: 'muted' }, 'Todavía no hay movimientos.'))]));
  $('#invoices').replaceChildren(...(user.invoices.length ? user.invoices.map(i => el('tr', {},
    el('td', {}, i.id), el('td', {}, fmtDate(i.date)), el('td', {}, i.concept + ' · ', el('span', { class: 'muted' }, i.status)), el('td', { class: 'num' }, fmtEuro(i.amount)))) : [el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Sin facturas: estás en el plan Gratuito.'))]));

  $('#simulateRenewal').disabled = !plan.monthly;
  $('#simulateRenewal').title = plan.monthly ? 'Adelanta el reloj al final del periodo: se aplica la renovación, el cambio de plan o la cancelación pendientes.' : 'Solo disponible con un plan de pago.';
  $('#resetDemo').hidden = !user.isDemo;
  const form = $('#profileForm');
  if (document.activeElement?.form !== form) { form.elements.namedItem('name').value = user.name; form.elements.namedItem('company').value = user.company || ''; }
}

async function run(statusSel, fn, okText) {
  const status = $(statusSel);
  status.className = 'form-status'; status.textContent = 'Un momento…';
  try { const r = await fn(); if (r && r.id) user = r; else user = await me(); status.className = 'form-status ok'; status.textContent = okText; render(); }
  catch (err) { status.className = 'form-status error'; status.textContent = err.message; }
}

async function onCancel() {
  if (!confirm('¿Cancelar la suscripción? Seguirás teniendo el plan ' + PLANS[user.plan].name + ' hasta el ' + fmtDate(user.periodEnd) + '.')) return;
  await run('#planStatus', cancelSubscription, 'Suscripción cancelada. No se renovará.');
}
async function onResume() { await run('#planStatus', resumeSubscription, 'Listo: tu suscripción seguirá renovándose.'); }

$('#simulateRenewal').addEventListener('click', () => run('#demoStatus', simulateRenewal, 'Fin de mes simulado: se ha aplicado la renovación.'));
$('#resetDemo').addEventListener('click', async () => {
  if (!confirm('¿Restablecer la cuenta de prueba? Volverá al plan Gratuito con 5 créditos y se borrará su historial.')) return;
  await run('#demoStatus', resetDemo, 'Cuenta de prueba restablecida: plan Gratuito con 5 créditos.');
});
$('#profileForm').addEventListener('submit', e => { e.preventDefault(); const f = e.currentTarget.elements; run('#profileStatus', () => updateProfile({ name: f.namedItem('name').value, company: f.namedItem('company').value }), 'Datos guardados.'); });
$('#passwordForm').addEventListener('submit', e => {
  e.preventDefault(); const form = e.currentTarget, f = form.elements;
  run('#passwordStatus', () => changePassword(f.namedItem('current').value, f.namedItem('next').value), 'Contraseña cambiada.').then(() => { if ($('#passwordStatus').classList.contains('ok')) form.reset(); });
});
$('#deleteForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!confirm('¿Seguro que quieres eliminar tu cuenta? No se puede deshacer.')) return;
  const status = $('#deleteStatus');
  try { await deleteAccount(e.currentTarget.elements.namedItem('password').value); toast('Cuenta eliminada.'); location.replace('./'); }
  catch (err) { status.className = 'form-status error'; status.textContent = err.message; }
});
$('#passwordForm').elements.namedItem('username').value = user.email;

onAccountChange(async () => { const u = await me(); if (!u) { location.replace('acceso.html'); return; } user = u; render(); });
render();
