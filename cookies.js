// Aviso de cookies y almacenamiento local. Se carga en todas las páginas públicas.
//
// Necesario (siempre activo, no requiere consentimiento): carrito, favoritos, tema claro/oscuro, sesión de la cuenta
// y la propia elección de cookies. Opcional (solo si el visitante acepta): recordar de dónde llegó (sitio de origen y
// campaña utm_*) hasta 30 días, para saber qué canales funcionan. Nada se envía a terceros ni se usa para publicidad.
(() => {
  'use strict';
  const KEY = 'elite-cookie-consent-v1', FIRST_TOUCH = 'elite-first-touch-v1', TTL_MS = 30 * 24 * 3600 * 1000;
  const readChoice = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && (v.choice === 'all' || v.choice === 'necessary') ? v.choice : null; } catch { return null; } };
  const writeChoice = choice => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, choice, at: new Date().toISOString() })); } catch { /* sin almacenamiento */ } };

  // Origen de la visita (solo con consentimiento): sitio de referencia y campaña, con caducidad de 30 días.
  function captureFirstTouch() {
    try {
      if (readChoice() !== 'all') { localStorage.removeItem(FIRST_TOUCH); return; }
      const saved = JSON.parse(localStorage.getItem(FIRST_TOUCH) || 'null');
      if (saved && Date.now() - Date.parse(saved.at) < TTL_MS) return;
      const params = new URLSearchParams(location.search);
      let external = '';
      try { const host = document.referrer ? new URL(document.referrer).hostname : ''; external = host && host !== location.hostname ? host : ''; } catch { /* referrer inválido */ }
      localStorage.setItem(FIRST_TOUCH, JSON.stringify({
        fuente: external || 'directo',
        utm: { source: (params.get('utm_source') || '').slice(0, 60), medium: (params.get('utm_medium') || '').slice(0, 60), campaign: (params.get('utm_campaign') || '').slice(0, 80) },
        pagina: location.pathname.slice(0, 80),
        at: new Date().toISOString(),
      }));
    } catch { /* sin almacenamiento */ }
  }

  let banner = null;
  function closeBanner() { banner?.remove(); banner = null; }
  function choose(choice) { writeChoice(choice); captureFirstTouch(); closeBanner(); }

  function openBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'cookie-banner'; banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-labelledby', 'cookie-title'); banner.setAttribute('aria-describedby', 'cookie-text');
    const title = document.createElement('strong'); title.id = 'cookie-title'; title.textContent = 'Cookies y almacenamiento local';
    const text = document.createElement('p'); text.id = 'cookie-text';
    text.append('Usamos almacenamiento local imprescindible (carrito, favoritos, tema y tu sesión). Si aceptas, también recordaremos de qué sitio llegaste (por ejemplo, Instagram) durante 30 días para saber qué canales funcionan. No usamos cookies de publicidad ni compartimos estos datos con terceros. ');
    const more = document.createElement('a'); more.href = '/privacidad.html#cookies'; more.textContent = 'Más información'; text.append(more, '.');
    const actions = document.createElement('div'); actions.className = 'cookie-actions';
    const all = document.createElement('button'); all.type = 'button'; all.className = 'button gold'; all.textContent = 'Aceptar todas'; all.addEventListener('click', () => choose('all'));
    const necessary = document.createElement('button'); necessary.type = 'button'; necessary.className = 'button outline'; necessary.textContent = 'Solo necesarias'; necessary.addEventListener('click', () => choose('necessary'));
    actions.append(all, necessary);
    banner.append(title, text, actions);
    document.body.append(banner);
  }

  // Enlace permanente para cambiar la elección en cualquier momento.
  function addFooterLink() {
    document.querySelectorAll('.footer').forEach(footer => {
      if (footer.querySelector('[data-cookie-settings]')) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cookie-prefs'; button.dataset.cookieSettings = '';
      button.textContent = 'Preferencias de cookies'; footer.append(button);
    });
    document.addEventListener('click', event => { if (event.target.closest('[data-cookie-settings]')) { event.preventDefault(); closeBanner(); openBanner(); } });
  }

  window.EliteConsent = { choice: readChoice, allowsOrigin: () => readChoice() === 'all', open: () => { closeBanner(); openBanner(); }, firstTouch() { try { return JSON.parse(localStorage.getItem(FIRST_TOUCH) || 'null'); } catch { return null; } } };

  const start = () => { addFooterLink(); captureFirstTouch(); if (!readChoice()) openBanner(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
