'use strict';
// Fotos de los perfumes: lupa al pasar el mouse (computadora) y visor a pantalla completa con acercar y mover
// (celular y computadora). Lo usan la ficha de la tienda (tienda.js) y la página de cada perfume.
(() => {
  const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const fineHover = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const ZOOM = 2;

  // Lupa: dentro del cuadro, la foto crece y sigue al mouse. No cambia el tamaño del cuadro ni mueve la página.
  function lens(box) {
    if (!box || box.dataset.lens) return;
    box.dataset.lens = '1';
    const img = () => box.querySelector('img');
    const place = e => {
      const r = box.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
      const i = img(); if (i) i.style.transformOrigin = Math.max(0, Math.min(100, x)) + '% ' + Math.max(0, Math.min(100, y)) + '%';
    };
    box.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse' || !fineHover() || !img()) return; place(e); box.classList.add('is-lens'); });
    box.addEventListener('pointermove', e => { if (box.classList.contains('is-lens')) place(e); });
    box.addEventListener('pointerleave', () => box.classList.remove('is-lens'));
  }

  // Visor: una ventana encima de todo (también encima de la ficha), con la foto entera; tocar o hacer clic acerca
  // en ese punto, arrastrar mueve la foto acercada y otro toque la devuelve. Esc o «Cerrar» lo cierra.
  let viewer, stage, picture, counter, prevBtn, nextBtn, list = [], index = 0, zoomed = false, drag = null, pan = { x: 0, y: 0 };
  function build() {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const button = (cls, label, text) => { const b = el('button', cls, text); b.type = 'button'; b.setAttribute('aria-label', label); return b; };
    viewer = el('dialog', 'zoom-viewer'); viewer.setAttribute('aria-label', 'Foto ampliada');
    const img = el('img'); img.alt = ''; img.draggable = false;
    const stageBox = el('div', 'zoom-stage'); stageBox.append(img);
    const hint = el('p', 'zoom-hint'); hint.append(el('span', 'zoom-count'), el('span', 'hint-out', 'Toca la foto para acercar'), el('span', 'hint-in', 'Arrastra para mover · toca para alejar'));
    viewer.append(button('zoom-close', 'Cerrar foto', '×'), stageBox, button('zoom-nav zoom-prev', 'Foto anterior', '‹'), button('zoom-nav zoom-next', 'Foto siguiente', '›'), hint);
    document.body.append(viewer);
    stage = viewer.querySelector('.zoom-stage'); picture = stage.querySelector('img'); counter = viewer.querySelector('.zoom-count');
    prevBtn = viewer.querySelector('.zoom-prev'); nextBtn = viewer.querySelector('.zoom-next');
    viewer.querySelector('.zoom-close').addEventListener('click', close);
    prevBtn.addEventListener('click', () => show(index - 1)); nextBtn.addEventListener('click', () => show(index + 1));
    viewer.addEventListener('click', e => { if (e.target === viewer) close(); });
    viewer.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' && list.length > 1) show(index - 1);
      if (e.key === 'ArrowRight' && list.length > 1) show(index + 1);
    });
    viewer.addEventListener('close', () => { setZoom(false); document.documentElement.classList.remove('zoom-open'); });
    stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; stage.setPointerCapture?.(e.pointerId); });
    stage.addEventListener('pointermove', e => {
      if (!drag || !zoomed) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; viewer.classList.add('is-dragging'); }
      pan = clamp(drag.px + dx, drag.py + dy); apply();
    });
    stage.addEventListener('pointerup', e => {
      const was = drag; drag = null; viewer.classList.remove('is-dragging');
      if (was?.moved) return;
      if (zoomed) { setZoom(false); return; }
      // Acercar en el punto tocado: ese punto queda en el centro de la pantalla.
      const r = picture.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      setZoom(true); pan = clamp((cx - e.clientX) * (ZOOM - 1), (cy - e.clientY) * (ZOOM - 1)); apply();
    });
    stage.addEventListener('pointercancel', () => { drag = null; viewer.classList.remove('is-dragging'); });
  }
  function clamp(x, y) {
    const w = picture.offsetWidth * (ZOOM - 1) / 2, h = picture.offsetHeight * (ZOOM - 1) / 2;
    return { x: Math.max(-w, Math.min(w, x)), y: Math.max(-h, Math.min(h, y)) };
  }
  function apply() { picture.style.transform = zoomed ? 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + ZOOM + ')' : ''; }
  function setZoom(on) { zoomed = on; pan = { x: 0, y: 0 }; viewer.classList.toggle('is-zoomed', on); apply(); }
  function show(i) {
    index = (i + list.length) % list.length;
    setZoom(false);
    picture.src = list[index].src; picture.alt = list[index].alt || '';
    counter.textContent = list.length > 1 ? (index + 1) + ' de ' + list.length + ' · ' : '';
    prevBtn.hidden = nextBtn.hidden = list.length < 2;
  }
  function open(items, start = 0) {
    list = (items || []).filter(item => item && item.src);
    if (!list.length) return;
    if (!viewer) build();
    viewer.classList.toggle('no-motion', calm());
    show(start);
    document.documentElement.classList.add('zoom-open');
    if (!viewer.open) viewer.showModal();
  }
  function close() { if (viewer?.open) viewer.close(); }

  window.EliteZoom = { open, close, lens };

  // Página de un perfume: foto principal con lupa, miniaturas que cambian la foto y botón para verla en grande.
  function productPage() {
    const box = document.querySelector('.product-detail-photo');
    const main = box?.querySelector('.zoomable img');
    if (!box || !main) return;
    const thumbs = [...box.querySelectorAll('.detail-thumbs button')];
    const items = thumbs.length ? thumbs.map(b => ({ src: b.dataset.full, alt: b.dataset.alt })) : [{ src: main.currentSrc || main.src, alt: main.alt }];
    let current = 0;
    const source = main.closest('picture')?.querySelector('source');
    thumbs.forEach((b, i) => b.addEventListener('click', () => {
      current = i;
      if (source) source.srcset = b.dataset.full;
      main.src = b.dataset.full; main.alt = b.dataset.alt || main.alt;
      thumbs.forEach(t => t.setAttribute('aria-pressed', String(t === b)));
    }));
    lens(box.querySelector('.zoomable'));
    box.querySelector('.zoomable').addEventListener('click', () => open(items, current));
    box.querySelector('.zoom-open-button')?.addEventListener('click', () => open(items, current));
  }
  if (document.body?.dataset.productId && !document.getElementById('productDialog')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', productPage); else productPage();
  }
})();
