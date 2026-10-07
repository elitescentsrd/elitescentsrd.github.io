// Estadísticas propias de Elite Scents RD (en nuestra base de datos; si la tienda activa Google Analytics o el píxel de
// Meta, medicion.js recibe los mismos eventos con su propio permiso). Solo cuentan si el visitante eligió
// «Aceptar todas» en el aviso de cookies. Se envía a la base de datos el tipo de evento (visita, perfume visto,
// búsqueda, búsqueda sin resultado, clic a WhatsApp, agregar al carrito), el número del perfume o el texto buscado,
// y en la visita el sitio de origen y si es celular o computadora. Nunca nombre, teléfono ni correo.
(() => {
  'use strict';
  const cfg = window.ELITE_SUPABASE || {};
  const base = String(cfg.url || '').replace(/\/$/, ''), key = cfg.publishableKey || '';
  const VISIT_KEY = 'elite-visit-v1';
  const allowed = () => Boolean(window.EliteConsent && window.EliteConsent.choice && window.EliteConsent.choice() === 'all') && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) && Boolean(key);
  const kinds = ['visita', 'perfume', 'busqueda', 'sin_resultado', 'whatsapp', 'carrito'];

  function send(kind, data = {}) {
    // Si la tienda activó Google Analytics o el píxel de Meta (medicion.js), reciben el mismo evento (con su propio permiso).
    window.EliteMedicion?.evento(kind, data);
    if (!kinds.includes(kind) || !allowed()) return;
    const body = { p_kind: kind, p_product_id: Number(data.product_id) > 0 ? Number(data.product_id) : null, p_term: data.term ? String(data.term).slice(0, 60) : null, p_source: data.source || null, p_device: data.device || null };
    try {
      fetch(base + '/rest/v1/rpc/track_event', { method: 'POST', keepalive: true, headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    } catch { /* sin conexión: no pasa nada */ }
  }

  // De dónde llegó (lo guarda cookies.js solo con permiso): campaña utm_source o el sitio que enlazó.
  function source() {
    const first = window.EliteConsent?.firstTouch?.() || {};
    const raw = String(first.utm?.source || first.fuente || '').toLowerCase();
    if (!raw || raw === 'directo') return null;
    for (const [match, name] of [['instagram', 'instagram'], ['facebook', 'facebook'], ['fb.', 'facebook'], ['google', 'google'], ['tiktok', 'tiktok'], ['whatsapp', 'whatsapp'], ['wa.me', 'whatsapp'], ['bing', 'bing'], ['youtube', 'youtube']])
      if (raw.includes(match)) return name;
    return raw.replace(/^www\./, '').slice(0, 40);
  }
  const device = () => (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) || /Mobi|Android/i.test(navigator.userAgent) ? 'movil' : 'computadora';

  function visit() {
    if (!allowed()) return;
    try { if (sessionStorage.getItem(VISIT_KEY)) return; sessionStorage.setItem(VISIT_KEY, '1'); } catch { /* sin almacenamiento */ }
    send('visita', { source: source(), device: device() });
  }

  // Clic a WhatsApp: desde una tarjeta, la ficha o la página del perfume se anota cuál era.
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href^="https://wa.me/"]');
    if (!link) return;
    const holder = link.closest('[data-product-id]') || (document.body.dataset.productId ? document.body : null);
    const dialogId = link.closest('#productDialog') ? document.getElementById('productDialog')?.dataset.productId : null;
    send('whatsapp', { product_id: dialogId || holder?.dataset.productId || null });
  }, true);

  window.EliteStats = { track: send };
  const start = () => {
    visit();
    if (document.body.dataset.productId) send('perfume', { product_id: document.body.dataset.productId });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
