'use strict';
// Medición con Google Analytics 4 y el píxel de Meta (Facebook e Instagram). Solo existe en las páginas de la tienda
// (portada, páginas de perfume y lista A–Z: nunca en el carrito, el panel, la encuesta, contacto ni reseñas) y solo
// carga las herramientas si el visitante eligió «Aceptar todas» y la tienda puso sus números en cookies.js.
// Eventos: página vista, perfume visto, búsqueda, agregar al carrito, ir al carrito y clic a WhatsApp. Nunca se envían
// nombres, teléfonos, correos ni búsquedas que parezcan datos personales. Si el visitante cambia a «Solo necesarias»,
// deja de enviar al instante (cookies.js borra sus cookies).
(() => {
  const consent = window.EliteConsent;
  const ids = consent?.terceros?.() || {};
  if (!ids.ga4 && !ids.metaPixel) return;
  let loaded = false;
  const allowed = () => consent.choice() === 'all';

  function addScript(src) { const s = document.createElement('script'); s.async = true; s.src = src; document.head.append(s); }
  function load() {
    if (loaded || !allowed()) return;
    loaded = true;
    if (ids.ga4) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      // Sin señales de Google ni anuncios personalizados: solo medir visitas y ventas.
      window.gtag('config', ids.ga4, { allow_google_signals: false, allow_ad_personalization_signals: false });
      addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ids.ga4));
    }
    if (ids.metaPixel && !window.fbq) {
      const fbq = window.fbq = function fbq() { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
      if (!window._fbq) window._fbq = fbq;
      fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
      // Sin configuración automática (no lee botones ni formularios de la página): solo los eventos de abajo.
      fbq('set', 'autoConfig', false, ids.metaPixel);
      fbq('init', ids.metaPixel);
      fbq('track', 'PageView');
      addScript('https://connect.facebook.net/en_US/fbevents.js');
    }
    // La página de un perfume cuenta como «perfume visto» (analytics.js corre antes que este archivo, así que su propio
    // aviso de la página no llega aquí: no se cuenta dos veces).
    const page = Number(document.body.dataset.productId);
    if (page > 0) event('perfume', { product_id: page });
  }

  const safeTerm = term => { const t = String(term || '').trim().slice(0, 60); return t.length >= 2 && !t.includes('@') && !/\d{6,}/.test(t) ? t : ''; };
  // Recibe los mismos eventos que las estadísticas propias (analytics.js) y los traduce a cada herramienta.
  function event(kind, data = {}) {
    if (!loaded || !allowed()) return;
    const id = Number(data.product_id) > 0 ? String(Number(data.product_id)) : '', value = Number(data.value) > 0 ? Number(data.value) : undefined;
    const product = id ? { content_ids: [id], content_type: 'product', ...(value ? { value, currency: 'DOP' } : {}) } : {};
    const item = id ? { items: [{ item_id: id }], ...(value ? { value, currency: 'DOP' } : {}) } : {};
    const ga = (name, params) => { if (ids.ga4 && window.gtag) window.gtag('event', name, params); };
    const meta = (name, params) => { if (ids.metaPixel && window.fbq) window.fbq('track', name, params); };
    if (kind === 'perfume' && id) { ga('view_item', item); meta('ViewContent', product); }
    else if (kind === 'carrito' && id) { ga('add_to_cart', item); meta('AddToCart', product); }
    else if (kind === 'whatsapp') { ga('generate_lead', { method: 'whatsapp', ...item }); meta('Contact', product); }
    else if (kind === 'busqueda' || kind === 'sin_resultado') { const term = safeTerm(data.term); if (term) { ga('search', { search_term: term }); meta('Search', { search_string: term }); } }
    else if (kind === 'checkout') { ga('begin_checkout', {}); meta('InitiateCheckout', {}); }
  }
  // Ir al carrito desde la tienda.
  document.addEventListener('click', e => { if (e.target.closest?.('a[href="/checkout.html"]')) event('checkout'); }, true);
  window.EliteMedicion = { evento: event };
  window.addEventListener('elite-consent', e => {
    if (e.detail?.choice === 'all') load();
    else if (loaded) {
      // Retiró el permiso: Google y Meta dejan de recibir (y ya no se envían eventos desde aquí).
      if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      if (window.fbq) window.fbq('consent', 'revoke');
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
