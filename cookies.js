// Aviso de cookies y almacenamiento local. Se carga en todas las páginas públicas.
//
// Necesario (siempre activo, no requiere consentimiento): carrito, favoritos, tema claro/oscuro, sesión de la cuenta
// y la propia elección de cookies. Opcional (solo si el visitante acepta): recordar de dónde llegó (sitio de origen y
// campaña utm_*) hasta 30 días y contar de forma anónima visitas, perfumes vistos y búsquedas (analytics.js), para
// saber qué canales y perfumes funcionan; y, solo si la tienda los activa abajo, Google Analytics y el píxel de Meta
// (medicion.js, únicamente en las páginas de la tienda).
(() => {
  'use strict';
  // Medición de Google y Meta: el ID de medición de Google Analytics 4 («G-…») y el ID del píxel de Meta (solo números).
  // Vacíos = apagados. Al ponerlos, el build agrega medicion.js a las páginas de la tienda y les abre la política de
  // seguridad solo para esos servidores; el aviso los nombra y se vuelve a pedir el permiso a quien había aceptado antes.
  const TERCEROS = { ga4: '', metaPixel: '' };
  const ids = { ga4: /^G-[A-Z0-9]{4,15}$/.test(TERCEROS.ga4) ? TERCEROS.ga4 : '', metaPixel: /^\d{8,20}$/.test(TERCEROS.metaPixel) ? TERCEROS.metaPixel : '' };
  const thirdParty = Boolean(ids.ga4 || ids.metaPixel);
  // Versión del aviso: un «Aceptar todas» dado antes de que hubiera Google o Meta no vale para ellos (se pregunta otra vez).
  const VERSION = thirdParty ? 2 : 1;
  const KEY = 'elite-cookie-consent-v1', FIRST_TOUCH = 'elite-first-touch-v1', TTL_MS = 30 * 24 * 3600 * 1000;
  const readChoice = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!v || (v.choice !== 'all' && v.choice !== 'necessary')) return null; return v.choice === 'all' && (Number(v.v) || 1) < VERSION ? null : v.choice; } catch { return null; } };
  const writeChoice = choice => { try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, choice, at: new Date().toISOString() })); } catch { /* sin almacenamiento */ } };
  // Al elegir «Solo necesarias» se borran las cookies que hubieran puesto Google o Meta en este sitio.
  function clearThirdPartyCookies() {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0].trim();
      if (!/^(_ga|_ga_[A-Z0-9]+|_gid|_gat[\w-]*|_fbp|_fbc)$/.test(name)) continue;
      for (const domain of ['', '; domain=' + location.hostname, '; domain=.' + location.hostname]) document.cookie = name + '=; Max-Age=0; path=/' + domain;
    }
  }

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
  function closeBanner() { banner?.remove(); banner = null; document.documentElement.classList.remove('cookie-open'); }
  function choose(choice) {
    writeChoice(choice); captureFirstTouch(); closeBanner();
    if (choice !== 'all') clearThirdPartyCookies();
    window.dispatchEvent(new CustomEvent('elite-consent', { detail: { choice } }));
  }

  function openBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'cookie-banner'; banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-labelledby', 'cookie-title'); banner.setAttribute('aria-describedby', 'cookie-text');
    const title = document.createElement('strong'); title.id = 'cookie-title'; title.textContent = 'Cookies y almacenamiento local';
    const text = document.createElement('p'); text.id = 'cookie-text';
    text.append(thirdParty
      ? 'Usamos almacenamiento local imprescindible (carrito, favoritos, tema y tu sesión). Si aceptas, también contaremos de forma anónima las visitas, los perfumes que se ven y lo que se busca, recordaremos de qué sitio llegaste (por ejemplo, Instagram) durante 30 días y usaremos ' +
        (ids.ga4 && ids.metaPixel ? 'Google Analytics y el píxel de Meta (Facebook e Instagram)' : ids.ga4 ? 'Google Analytics' : 'el píxel de Meta (Facebook e Instagram)') + ', que guardan sus cookies para medir las visitas y los anuncios. Nunca les enviamos tu nombre, teléfono ni correo. '
      : 'Usamos almacenamiento local imprescindible (carrito, favoritos, tema y tu sesión). Si aceptas, también contaremos de forma anónima las visitas, los perfumes que se ven y lo que se busca, y recordaremos de qué sitio llegaste (por ejemplo, Instagram) durante 30 días. No usamos cookies de publicidad ni compartimos estos datos con terceros. ');
    const more = document.createElement('a'); more.href = '/privacidad.html#cookies'; more.textContent = 'Más información'; text.append(more, '.');
    const actions = document.createElement('div'); actions.className = 'cookie-actions';
    const all = document.createElement('button'); all.type = 'button'; all.className = 'button gold'; all.textContent = 'Aceptar todas'; all.addEventListener('click', () => choose('all'));
    const necessary = document.createElement('button'); necessary.type = 'button'; necessary.className = 'button outline'; necessary.textContent = 'Solo necesarias'; necessary.addEventListener('click', () => choose('necessary'));
    actions.append(all, necessary);
    banner.append(title, text, actions);
    document.body.append(banner);
    document.documentElement.classList.add('cookie-open');
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

  window.EliteConsent = { choice: readChoice, allowsOrigin: () => readChoice() === 'all', open: () => { closeBanner(); openBanner(); }, terceros: () => ({ ...ids }), firstTouch() { try { return JSON.parse(localStorage.getItem(FIRST_TOUCH) || 'null'); } catch { return null; } } };

  const start = () => { addFooterLink(); captureFirstTouch(); if (!readChoice()) openBanner(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
