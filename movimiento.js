'use strict';
// Movimiento de la portada: lo que aparece al bajar, la cinta de marcas, los perfumes destacados que rotan sobre la foto,
// las flechas de las secciones, el carrito que salta al agregar y el encabezado con sombra al bajar.
// Todo es decoración: sin este archivo la tienda se ve y funciona igual. Si el aparato pide «reducir movimiento», no se
// anima nada (la cinta y los destacados quedan quietos y se pueden recorrer a mano).
(() => {
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  // Casi todo espera a que la página termine de cargar y el teléfono esté libre: así no compite con la primera vista.
  const idle = cb => window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 250);
  const afterLoad = cb => document.readyState === 'complete' ? idle(cb) : window.addEventListener('load', () => idle(cb), { once: true });

  // ---- Encabezado: sombra suave al bajar (sin cambiar su alto, para que nada salte).
  const header = $('.header');
  if (header) {
    let ticking = false;
    const update = () => { header.classList.toggle('scrolled', window.scrollY > 24); ticking = false; };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---- Carrito: el número salta cuando sube.
  const cartCount = $('#cartCount');
  if (cartCount && !calm) {
    let last = Number(cartCount.textContent) || 0;
    new MutationObserver(() => {
      const now = Number(cartCount.textContent) || 0;
      // Salto corto con la Web Animations API: se puede repetir sin forzar cálculos de la página.
      if (now > last) cartCount.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      last = now;
    }).observe(cartCount, { childList: true, characterData: true, subtree: true });
  }

  // ---- Cinta de marcas: botón para pausarla (también se detiene al pasar el ratón o al llegar con el teclado).
  const strip = $('.brand-strip'), stripToggle = $('#marqueeToggle');
  const marquee = strip?.querySelector('.marquee');
  // Al salir del teclado la cinta vuelve a empezar desde el principio (sin quedar corrida a un lado).
  marquee?.addEventListener('focusout', e => { if (!marquee.contains(e.relatedTarget)) marquee.scrollLeft = 0; });
  if (strip && stripToggle) {
    if (calm) stripToggle.hidden = true;
    stripToggle.addEventListener('click', () => {
      const paused = stripToggle.getAttribute('aria-pressed') !== 'true';
      stripToggle.setAttribute('aria-pressed', String(paused)); strip.classList.toggle('paused', paused);
    });
  }

  // ---- Perfumes destacados sobre la foto: rotan cada 5 segundos; se pausan con el botón, al pasar el ratón o con el foco.
  const spot = $('#heroSpotlight'), slidesBox = $('#spotSlides'), dotsBox = $('#spotDots'), spotPause = $('#spotPause');
  if (spot && slidesBox && dotsBox && spotPause) {
    const DELAY = 5000;
    let index = 0, timer = 0, frame = 0, userPaused = calm, hovering = false;
    const slides = () => [...slidesBox.querySelectorAll('.spot-slide')];
    const running = () => !userPaused && !hovering && !document.hidden && slides().length > 1;
    function show(i) {
      const list = slides(); if (!list.length) return;
      index = (i + list.length) % list.length;
      list.forEach((el, k) => { const on = k === index; el.classList.toggle('active', on); el.inert = !on; });
      [...dotsBox.children].forEach((d, k) => d.setAttribute('aria-current', String(k === index)));
      restart();
    }
    function restart() {
      clearTimeout(timer); cancelAnimationFrame(frame);
      spot.classList.remove('ticking');
      // La barrita vuelve a empezar en el cuadro siguiente (sin obligar al navegador a recalcular la página ahora).
      if (running()) { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => spot.classList.add('ticking')); }); timer = setTimeout(() => show(index + 1), DELAY); }
      spot.classList.toggle('stopped', !running());
      // Mientras rota sola no se anuncia cada cambio; en pausa, sí.
      slidesBox.setAttribute('aria-live', running() ? 'off' : 'polite');
    }
    function build() {
      const list = slides();
      dotsBox.replaceChildren(...list.map((_, k) => {
        const d = document.createElement('button'); d.type = 'button';
        d.setAttribute('aria-label', 'Perfume destacado ' + (k + 1) + ' de ' + list.length);
        d.addEventListener('click', () => show(k)); return d;
      }));
      spot.style.setProperty('--spot-ms', DELAY + 'ms');
      spot.classList.toggle('ready', list.length > 1);
      spotPause.setAttribute('aria-pressed', String(userPaused));
      show(Math.min(index, Math.max(list.length - 1, 0)));
    }
    spotPause.addEventListener('click', () => { userPaused = !userPaused; spotPause.setAttribute('aria-pressed', String(userPaused)); restart(); });
    spot.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovering = true; restart(); } });
    spot.addEventListener('pointerleave', () => { if (hovering) { hovering = false; restart(); } });
    spot.addEventListener('focusin', () => { hovering = true; restart(); });
    spot.addEventListener('focusout', e => { if (!spot.contains(e.relatedTarget)) { hovering = false; restart(); } });
    document.addEventListener('visibilitychange', restart);
    // Empieza a rotar cuando la página ya cargó (la primera vista no espera por esto).
    afterLoad(() => { new MutationObserver(build).observe(slidesBox, { childList: true }); if (slides().length) build(); });
  }

  afterLoad(() => { revealOnScroll(); shelfArrows(); });

  // ---- Secciones destacadas: flechas para pasar perfumes (en el celular se desliza con el dedo). Saber si hay más a cada
  // lado se pregunta con IntersectionObserver (lo calcula el navegador cuando ya dibujó; no se fuerza ningún cálculo).
  function shelfArrows() {
    for (const shelf of $$('.shelf')) {
      const row = shelf.querySelector('.shelf-row'), head = shelf.querySelector('.shelf-head');
      if (!row || !head) continue;
      const title = shelf.querySelector('h2')?.textContent.trim() || 'la sección';
      const nav = document.createElement('div'); nav.className = 'shelf-nav'; nav.hidden = true;
      const arrow = (dir, text) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'shelf-arrow';
        b.setAttribute('aria-label', (dir < 0 ? 'Perfumes anteriores de ' : 'Más perfumes de ') + title); b.textContent = text;
        b.addEventListener('click', () => row.scrollBy({ left: dir * Math.max(row.clientWidth * 0.85, 200), behavior: calm ? 'auto' : 'smooth' }));
        return b;
      };
      const prev = arrow(-1, '←'), next = arrow(1, '→'), tools = document.createElement('div'), all = head.querySelector('[data-shelf-all]');
      tools.className = 'shelf-tools'; nav.append(prev, next); tools.append(...(all ? [all] : []), nav); head.append(tools);
      const seen = new Map();
      const edges = new IntersectionObserver(entries => {
        for (const e of entries) seen.set(e.target, e.intersectionRatio > 0.97);
        const cards = row.querySelectorAll('.perfume'), first = cards[0], last = cards[cards.length - 1];
        const atStart = !first || seen.get(first) !== false, atEnd = !last || seen.get(last) !== false;
        prev.disabled = atStart; next.disabled = atEnd; nav.hidden = atStart && atEnd;
      }, { root: row, threshold: [0, 0.97, 1] });
      const watchEdges = () => {
        edges.disconnect(); seen.clear();
        const cards = row.querySelectorAll('.perfume');
        if (cards.length) { edges.observe(cards[0]); edges.observe(cards[cards.length - 1]); } else nav.hidden = true;
      };
      new MutationObserver(watchEdges).observe(row, { childList: true });
      watchEdges();
    }
  }

  // ---- Aparecer al bajar: títulos, ventajas, tarjetas y preguntas suben con un fundido la primera vez que se ven.
  // Solo se esconde lo que todavía está más abajo de la pantalla (nada de lo que ya se ve parpadea). La primera noticia
  // del IntersectionObserver dice dónde está cada cosa, sin forzar cálculos de la página.
  function revealOnScroll() {
    if (calm || !('IntersectionObserver' in window)) return;
    const done = el => { el.classList.remove('reveal', 'in'); el.style.removeProperty('--d'); };
    const boxOf = el => el.dataset.productId ? el.closest('[data-reveal-cards]') : null;
    const io = new IntersectionObserver(entries => {
      // El alto de la pantalla se lee una sola vez, antes de cambiar nada (leerlo después de un cambio obliga a recalcular).
      const shown = [], screen = entries[0]?.rootBounds ? entries[0].rootBounds.bottom / 0.94 : window.innerHeight;
      for (const e of entries) {
        const el = e.target;
        if (!el.classList.contains('reveal')) {
          // Primera noticia: si ya está a la vista (o más arriba), se queda como está; si está más abajo, se esconde.
          if (e.isIntersecting || e.boundingClientRect.top < screen) { io.unobserve(el); boxOf(el)?._seen.add(el.dataset.productId); }
          else el.classList.add('reveal');
        } else if (e.isIntersecting && e.intersectionRatio >= 0.1) shown.push(el);
      }
      shown.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      shown.forEach((el, i) => {
        io.unobserve(el); boxOf(el)?._seen.add(el.dataset.productId);
        el.style.setProperty('--d', Math.min(i * 70, 420) + 'ms');
        el.classList.add('in');
        el.addEventListener('transitionend', () => done(el), { once: true });
        setTimeout(() => done(el), 1600);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: [0, 0.12] });
    // Tarjetas nuevas que salen por algo que hizo el cliente (buscar, filtrar, «Ver más», una marca): aparecen con el efecto
    // aunque ya estén a la vista. Si la lista se vuelve a dibujar con los mismos perfumes (un favorito), no se repite.
    let fresh = 0;
    const touched = () => { fresh = Date.now(); };
    document.addEventListener('input', e => { if (e.target.closest?.('.catalog-tools')) touched(); }, true);
    document.addEventListener('change', e => { if (e.target.closest?.('.catalog-tools')) touched(); }, true);
    document.addEventListener('click', e => { if (e.target.closest?.('#more, [data-filter], #favoritesOnly, #clearFilters, [data-brand], [data-shelf-all], #suggestions, #finderCatalog')) touched(); }, true);
    const boxes = $$('#productGrid, .shelf-row');
    boxes.forEach(box => { box.dataset.revealCards = ''; box._seen = new Set(); });
    $$('.benefits > div, .section-head, .shelf-head, .finder-callout, .story > div, .testimonial-empty, .faq details, .brand-strip, .footer > div').forEach(el => io.observe(el));
    boxes.forEach(box => box.querySelectorAll('.perfume[data-product-id]').forEach(card => io.observe(card)));
    for (const box of boxes) new MutationObserver(records => {
      for (const r of records) for (const node of r.removedNodes) if (node.nodeType === 1) io.unobserve(node);
      const byUser = Date.now() - fresh < 800;
      for (const card of box.querySelectorAll('.perfume[data-product-id]:not(.reveal)')) {
        if (box._seen.has(card.dataset.productId)) continue;
        if (byUser) card.classList.add('reveal');
        io.observe(card);
      }
    }).observe(box, { childList: true });
  }
})();
