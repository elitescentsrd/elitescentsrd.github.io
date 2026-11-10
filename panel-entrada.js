'use strict';
// Disfraz del panel: para cualquiera que entre a /admin.html, la página se ve como un «404 página no encontrada». El
// panel (y su login) solo aparece si:
//   1) ya hay una sesión iniciada en esta pestaña, o
//   2) la dirección trae la palabra secreta: /admin.html#<palabra>  (p. ej. /admin.html#lunallena)
// La palabra NO da acceso: solo descubre el formulario de login. Entrar sigue pidiendo tu correo, contraseña y la
// verificación en dos pasos. Esto solo evita que visitantes al azar y robots sepan que el panel existe.
//
// La palabra no se guarda aquí en claro, solo su «huella» (SHA-256). Para cambiarla, calcula la huella de tu palabra
// nueva y ponla en CLAVES. En la terminal:  node -e "console.log(require('crypto').createHash('sha256').update('TU-PALABRA').digest('hex'))"
(function () {
  var CLAVES = ['efa384e63e86d15ba33ef84769bb05a176957c73c2d70692ade5cde081f2fd62']; // huella de la palabra secreta
  var root = document.documentElement, FLAG = 'elite-panel-abierto-v1', SESION = 'elite-admin-session-v1';
  function tieneSesion() { try { return !!JSON.parse(sessionStorage.getItem(SESION) || 'null') || sessionStorage.getItem(FLAG) === '1' || localStorage.getItem(SESION); } catch (e) { return false; } }
  function abrir(guardar) {
    if (guardar) { try { sessionStorage.setItem(FLAG, '1'); } catch (e) {} if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } } }
    root.classList.add('panel-abierto');
  }
  async function revisarHash() {
    var frag = decodeURIComponent((location.hash || '').replace(/^#/, '')).trim().toLowerCase();
    if (!frag || !window.crypto || !crypto.subtle) return;
    try {
      var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(frag));
      var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      if (CLAVES.indexOf(hex) !== -1) abrir(true);
    } catch (e) { /* sin crypto: queda oculto */ }
  }
  if (tieneSesion()) abrir(false); else revisarHash();
  // Si la persona escribe la palabra secreta después (o navega por el panel ya abierto), se vuelve a comprobar.
  window.addEventListener('hashchange', function () { if (!root.classList.contains('panel-abierto')) revisarHash(); });
})();
