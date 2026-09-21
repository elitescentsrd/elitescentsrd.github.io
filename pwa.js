'use strict';
// App instalable: registra el service worker y muestra el botón "Instalar la tienda" cuando el celular lo permite.
(() => {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
  const buttons = () => document.querySelectorAll('[data-install-app]');
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;
  const show = visible => buttons().forEach(button => { button.hidden = !visible; });

  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; if (!standalone()) show(true); });
  window.addEventListener('appinstalled', () => { deferred = null; show(false); });

  function help() {
    let dialog = document.getElementById('installHelp');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'installHelp'; dialog.className = 'install-dialog'; dialog.setAttribute('aria-labelledby', 'installHelpTitle');
      const title = document.createElement('h2'); title.id = 'installHelpTitle'; title.textContent = 'Instala Elite Scents en tu celular';
      const steps = document.createElement('ol');
      ['Toca el botón Compartir de Safari (el cuadro con una flecha hacia arriba).', 'Elige "Añadir a pantalla de inicio".', 'Confirma con "Añadir". Verás el ícono de Elite Scents junto a tus otras apps.'].forEach(text => { const li = document.createElement('li'); li.textContent = text; steps.append(li); });
      const close = document.createElement('button'); close.type = 'button'; close.className = 'button gold'; close.textContent = 'Entendido';
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      dialog.append(title, steps, close); document.body.append(dialog);
    }
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener('click', async event => {
    if (!event.target.closest('[data-install-app]')) return;
    if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch {} deferred = null; show(false); }
    else help();
  });

  // iPhone/iPad: Safari no avisa que se puede instalar, así que se muestra el botón con las instrucciones.
  const init = () => { if (!standalone() && isIos()) show(true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
