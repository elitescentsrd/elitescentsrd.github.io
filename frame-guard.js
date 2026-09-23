'use strict';
// Protección contra "clickjacking" y copias que meten la tienda dentro de otra página (iframe).
// GitHub Pages no permite enviar la cabecera X-Frame-Options, así que se hace aquí:
//  - Si la página está dentro de un marco, intenta abrirse sola a pantalla completa y, si no puede, se oculta.
//  - En el panel y el carrito (<html class="guarded">) la página solo se muestra cuando este archivo confirma que no
//    hay marco; así, si el JavaScript no carga, tampoco queda a la vista un formulario con contraseña.
//  - Ningún formulario se envía "a la antigua" (poniendo los datos en la dirección): todos los maneja el JavaScript.
(function () {
  var root = document.documentElement;
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) root.classList.add('guard-ok');
  else {
    root.classList.add('framed');
    try { window.top.location.replace(window.location.href); } catch (e) { /* marco restringido: la página sigue oculta */ }
  }
  document.addEventListener('submit', function (event) { event.preventDefault(); }, true);
})();
