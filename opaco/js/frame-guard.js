'use strict';
// Protección contra "clickjacking": GitHub Pages no permite enviar X-Frame-Options, así que si alguien mete Opaco dentro
// de un marco de otra web, la página intenta abrirse sola a pantalla completa y, si no puede, se oculta.
(function () {
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) return;
  document.documentElement.style.display = 'none';
  try { window.top.location.replace(window.location.href); } catch (e) { /* marco restringido: la página sigue oculta */ }
})();
