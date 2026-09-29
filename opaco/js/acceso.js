// Inicio de sesión y registro.
import { login, register, me, DEMO, isPersistent } from './api.js';
import { $, initHeader } from './common.js';

const params = new URLSearchParams(location.search);
const next = (params.get('siguiente') || 'app.html').replace(/^\/+|^[a-z]+:/gi, ''); // solo páginas de este sitio
const go = () => location.replace(/^[\w.-]+\.html(\?[\w=&%.-]*)?$/.test(next) ? next : 'app.html');

function setMode(mode) {
  const reg = mode === 'registro';
  $('#tabLogin').setAttribute('aria-selected', String(!reg));
  $('#tabRegister').setAttribute('aria-selected', String(reg));
  $('#loginForm').hidden = reg; $('#registerForm').hidden = !reg;
  (reg ? $('#regName') : $('#loginEmail')).focus();
}
$('#tabLogin').addEventListener('click', () => setMode('entrar'));
$('#tabRegister').addEventListener('click', () => setMode('registro'));
$('#fillDemo').addEventListener('click', () => { $('#loginEmail').value = DEMO.email; $('#loginPassword').value = DEMO.password; $('#loginForm button[type=submit]').focus(); });

function busy(form, on) { form.querySelectorAll('button, input').forEach(n => { n.disabled = on; }); }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget, status = $('#loginStatus');
  status.className = 'form-status'; status.textContent = 'Comprobando…';
  busy(form, true);
  try { await login(form.elements.namedItem('email').value, form.elements.namedItem('password').value); status.className = 'form-status ok'; status.textContent = 'Sesión iniciada.'; go(); }
  catch (err) { status.className = 'form-status error'; status.textContent = err.message; busy(form, false); form.elements.namedItem('password').select(); }
});

$('#registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget, status = $('#registerStatus');
  status.className = 'form-status'; status.textContent = 'Creando la cuenta…';
  busy(form, true);
  try {
    const f = n => form.elements.namedItem(n);
    await register({ name: f('name').value, company: f('company').value, email: f('email').value, password: f('password').value, accept: f('accept').checked });
    status.className = 'form-status ok'; status.textContent = 'Cuenta creada. Tienes 5 créditos.';
    go();
  } catch (err) {
    status.className = 'form-status error'; status.textContent = err.message; busy(form, false);
    if (err.code === 'exists') { $('#loginEmail').value = form.elements.namedItem('email').value; }
  }
});

if (!isPersistent()) $('#storageNote').textContent = 'Tu navegador no permite guardar datos de esta web: la cuenta solo durará mientras tengas esta pestaña abierta.';
if (params.get('salida')) $('#loginStatus').textContent = 'Has cerrado la sesión.';
setMode(params.get('modo') === 'registro' ? 'registro' : 'entrar');
initHeader();
me().then(u => { if (u && !params.get('salida')) go(); });
