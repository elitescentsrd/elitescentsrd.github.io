'use strict';
// Página para calificar un pedido entregado. El enlace personal (lo manda la tienda por WhatsApp o está en «Mis pedidos»)
// lleva una clave después de # (esa parte no viaja a ningún servidor al abrir la página): con ella la base de datos dice
// qué perfumes trae el pedido (review_invite) y guarda cada opinión «pendiente» hasta que la tienda la revise
// (submit_review). Solo se publica el nombre que escribe el cliente, las estrellas y el comentario.
(() => {
  const cfg = window.ELITE_SUPABASE || {};
  const base = String(cfg.url || '').replace(/\/$/, ''), key = cfg.publishableKey || '';
  const $ = id => document.getElementById(id);
  const intro = $('reviewIntro'), problem = $('reviewProblem'), form = $('reviewForm'), list = $('reviewProducts');
  const error = $('reviewError'), done = $('reviewDone'), send = $('reviewSend');
  const token = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const WORDS = ['', 'Malo', 'Regular', 'Bueno', 'Muy bueno', 'Excelente'];
  let firstName = '', sending = false;

  async function rpc(name, body) {
    const res = await fetch(base + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || typeof out.ok !== 'boolean') throw new Error('HTTP ' + res.status);
    return out;
  }
  function fail(text) {
    intro.hidden = true; form.hidden = true;
    const wa = document.createElement('a'); wa.className = 'text-underline'; wa.target = '_blank'; wa.rel = 'noopener noreferrer';
    wa.href = 'https://wa.me/18094333348?text=' + encodeURIComponent('Hola Elite Scents RD, quiero calificar mi pedido pero el enlace no me funciona.');
    wa.textContent = 'Escribir por WhatsApp ↗';
    problem.replaceChildren(text, ' ', wa); problem.hidden = false;
  }

  function stars(p, box) {
    const row = document.createElement('div'); row.className = 'star-row';
    const group = document.createElement('div'); group.className = 'star-input';
    for (let n = 1; n <= 5; n++) {
      const label = document.createElement('label'); label.className = 'star';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'rating-' + p.id; input.value = String(n); input.className = 'sr-only';
      const icon = document.createElement('span'); icon.className = 'star-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '★';
      const text = document.createElement('span'); text.className = 'sr-only'; text.textContent = n === 1 ? '1 estrella (malo)' : n + ' estrellas (' + WORDS[n].toLowerCase() + ')';
      label.append(input, icon, text); group.append(label);
    }
    const word = document.createElement('span'); word.className = 'star-word'; word.setAttribute('aria-hidden', 'true');
    group.addEventListener('change', e => {
      const n = Number(e.target.value); group.dataset.value = String(n); word.textContent = WORDS[n]; box.classList.remove('missing'); error.hidden = true;
      // La estrella elegida da un saltito (Web Animations: se puede repetir sin recalcular la página).
      if (!calm) e.target.nextElementSibling?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    });
    row.append(group, word); return row;
  }

  function item(p) {
    const box = document.createElement('fieldset'); box.className = 'review-item'; box.dataset.productId = String(p.id);
    const legend = document.createElement('legend'); legend.textContent = p.name + (p.size ? ' · ' + p.size : '');
    const photo = document.createElement('div'); photo.className = 'review-photo';
    box.append(legend, photo);
    if (p.reviewed) { markDone(box, 'Ya calificaste este perfume. ¡Gracias!'); return box; }
    const label = document.createElement('label'); label.className = 'review-comment'; label.textContent = 'Tu comentario (opcional)';
    const area = document.createElement('textarea'); area.name = 'comment-' + p.id; area.maxLength = 600; area.rows = 3; area.placeholder = '¿Cómo huele? ¿Cuánto te dura? ¿Lo recomiendas?';
    label.append(area);
    const status = document.createElement('p'); status.className = 'review-item-status'; status.setAttribute('aria-live', 'polite');
    box.append(stars(p, box), label, status);
    return box;
  }
  function markDone(box, text) {
    box.classList.add('is-done');
    box.querySelectorAll('.star-row, .review-comment').forEach(el => el.remove());
    let status = box.querySelector('.review-item-status');
    if (!status) { status = document.createElement('p'); status.className = 'review-item-status'; box.append(status); }
    status.textContent = '✓ ' + text;
  }

  // Fotos: las mismas del catálogo público (si no cargan, la página funciona igual).
  async function photos(ids) {
    try {
      const res = await fetch('/perfumes.json'); if (!res.ok) return;
      const byId = new Map((await res.json()).map(p => [Number(p.id), p]));
      for (const box of list.querySelectorAll('.review-item')) {
        const url = byId.get(Number(box.dataset.productId))?.image_url || '';
        if (!ids.includes(Number(box.dataset.productId)) || !(/^\/img\/productos\/[^/]+\.(jpe?g|png|webp)$/i.test(url) || /^https:\/\//i.test(url))) continue;
        const img = document.createElement('img'); img.alt = ''; img.width = 72; img.height = 72; img.decoding = 'async';
        img.src = /^\/img\/productos\/[^/]+\.(jpe?g|png)$/i.test(url) ? url.replace('/img/productos/', '/img/productos/thumbs/').replace(/\.(jpe?g|png)$/i, '.webp') : url;
        box.querySelector('.review-photo').append(img);
      }
    } catch { /* sin fotos */ }
  }

  async function start() {
    if (!/^[0-9a-f]{32}$/.test(token)) { fail('Este enlace no es válido. Escríbenos y te enviamos uno nuevo.'); return; }
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || !key) { fail('No pudimos abrir tu pedido en este momento.'); return; }
    let info;
    try { info = await rpc('review_invite', { p_token: token }); }
    catch { fail('No pudimos abrir tu pedido en este momento. Inténtalo otra vez en un rato.'); return; }
    if (!info.ok) { fail(info.message || 'Este enlace no es válido.'); return; }
    const products = Array.isArray(info.products) ? info.products : [];
    if (!products.length) { fail('Este pedido no tiene perfumes para calificar.'); return; }
    firstName = String(info.first_name || '');
    $('reviewTitle').textContent = firstName ? firstName + ', ¿qué te pareció tu perfume?' : '¿Qué te pareció tu perfume?';
    intro.textContent = products.length > 1 ? 'Toca las estrellas de cada perfume (de 1 a 5). Calificar uno ya ayuda.' : 'Toca las estrellas (de 1 a 5) y, si quieres, cuéntanos más.';
    list.replaceChildren(...products.map(item));
    if (firstName && !form.elements.author.value) form.elements.author.value = firstName + ' ';
    if (products.every(p => p.reviewed)) { finish('Ya calificaste todos los perfumes de este pedido. ¡Gracias!'); return; }
    form.hidden = false;
    photos(products.map(p => Number(p.id)));
  }

  function finish(text) {
    form.hidden = true; intro.hidden = true;
    $('reviewDoneText').textContent = text;
    done.hidden = false; done.focus();
  }
  function showError(text, focusEl) { error.textContent = text; error.hidden = false; focusEl?.focus(); }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    error.hidden = true;
    const author = form.elements.author.value.trim().replace(/\s+/g, ' ');
    const pending = [...list.querySelectorAll('.review-item:not(.is-done)')].map(box => ({
      box, id: Number(box.dataset.productId), rating: Number(box.querySelector('input[type=radio]:checked')?.value || 0), comment: box.querySelector('textarea')?.value || '',
    }));
    const chosen = pending.filter(r => r.rating >= 1 && r.rating <= 5);
    if (!chosen.length) { pending.forEach(r => r.box.classList.add('missing')); showError('Elige las estrellas de al menos un perfume.', pending[0]?.box.querySelector('input[type=radio]')); return; }
    if (author.length < 2 || author.length > 40 || /[<>{}]/.test(author) || !/\p{L}/u.test(author)) { showError('Escribe el nombre con el que se verá tu opinión (de 2 a 40 letras).', form.elements.author); return; }
    const linked = chosen.find(r => /(https?:\/\/|www\.)/i.test(r.comment));
    if (linked) { showError('Quita los enlaces del comentario.', linked.box.querySelector('textarea')); return; }
    sending = true; send.disabled = true; send.textContent = 'Enviando…';
    let sent = 0, failed = false;
    for (const r of chosen) {
      const status = r.box.querySelector('.review-item-status');
      try {
        const out = await rpc('submit_review', { p_token: token, p_product_id: r.id, p_rating: r.rating, p_comment: r.comment, p_author: author });
        if (out.ok) { sent++; markDone(r.box, out.already ? 'Ya habías calificado este perfume. ¡Gracias!' : 'Recibida. ¡Gracias!'); }
        else { failed = true; status.textContent = out.message || 'No se pudo enviar.'; }
      } catch { failed = true; status.textContent = 'No se pudo enviar. Inténtalo otra vez en un momento.'; }
    }
    sending = false; send.disabled = false; send.textContent = 'Enviar mi opinión';
    const left = list.querySelectorAll('.review-item:not(.is-done)').length;
    if (!failed && !left) finish((firstName ? '¡Gracias, ' + firstName + '! ' : '¡Gracias! ') + 'Publicaremos tu opinión en la tienda cuando la revisemos.');
    else if (!failed && sent) intro.textContent = 'Recibimos tu opinión. Si quieres, califica también los demás perfumes.';
  });

  start();
})();
