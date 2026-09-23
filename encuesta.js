'use strict';
// Página de la encuesta: dibuja las preguntas de survey.js, guarda las respuestas en este dispositivo y lleva a la cuenta.
// Al entrar (o crear la cuenta), customer.js las envía a Supabase y muestra el cupón personal.
(() => {
  const S = window.EliteSurvey, cfg = window.ELITE_SUPABASE || {};
  const $ = s => document.querySelector(s);
  const form = $('#surveyForm'), box = $('#surveyQuestions'), error = $('#surveyError');
  const PENDING_KEY = 'elite-survey-pending-v1';
  const money = n => 'RD$' + new Intl.NumberFormat('es-DO').format(Number(n) || 0);
  if (!S || !form) return;

  S.QUESTIONS.forEach((q, n) => {
    const field = document.createElement('fieldset'); field.className = 'survey-question'; field.dataset.question = q.id;
    const legend = document.createElement('legend'); legend.textContent = (n + 1) + '. ' + q.text; field.append(legend);
    if (q.help) { const help = document.createElement('p'); help.className = 'survey-help'; help.textContent = q.help; field.append(help); }
    if (q.type === 'single' || q.type === 'multi') {
      const options = document.createElement('div'); options.className = 'survey-options';
      q.options.forEach((text, i) => {
        const label = document.createElement('label'); label.className = 'survey-option';
        const input = document.createElement('input'); input.type = q.type === 'single' ? 'radio' : 'checkbox'; input.name = q.id; input.value = text; input.id = q.id + '-' + i;
        const span = document.createElement('span'); span.textContent = text;
        label.append(input, span); options.append(label);
      });
      field.append(options);
    } else {
      const input = document.createElement(q.type === 'longtext' ? 'textarea' : 'input');
      if (q.type === 'text') input.type = 'text';
      input.name = q.id; input.maxLength = q.max || 300; input.setAttribute('aria-label', q.text);
      field.append(input);
    }
    box.append(field);
  });

  // Preguntas de varias opciones: no deja marcar más del máximo.
  form.addEventListener('change', event => {
    const q = S.QUESTIONS.find(x => x.id === event.target.name);
    if (q && q.type === 'multi' && q.max && form.querySelectorAll('input[name="' + q.id + '"]:checked').length > q.max) event.target.checked = false;
    event.target.closest('.survey-question')?.classList.remove('missing');
  });

  function collect() {
    const raw = {};
    for (const q of S.QUESTIONS) {
      if (q.type === 'single') raw[q.id] = form.querySelector('input[name="' + q.id + '"]:checked')?.value || '';
      else if (q.type === 'multi') raw[q.id] = [...form.querySelectorAll('input[name="' + q.id + '"]:checked')].map(i => i.value);
      else raw[q.id] = form.elements[q.id].value;
    }
    return raw;
  }
  // Si la persona vuelve a la página, se muestran las respuestas que ya había marcado.
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (saved && saved.answers) for (const q of S.QUESTIONS) {
      const v = saved.answers[q.id];
      if (q.type === 'single' || q.type === 'multi') (Array.isArray(v) ? v : [v]).forEach(value => { const input = [...form.querySelectorAll('input[name="' + q.id + '"]')].find(i => i.value === value); if (input) input.checked = true; });
      else if (typeof v === 'string') form.elements[q.id].value = v;
    }
  } catch { /* sin respuestas guardadas */ }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const { answers, missing } = S.clean(collect());
    form.querySelectorAll('.survey-question').forEach(field => field.classList.toggle('missing', missing.includes(field.dataset.question)));
    if (missing.length) {
      error.hidden = false; error.textContent = missing.length === 1 ? 'Te falta 1 pregunta por responder.' : 'Te faltan ' + missing.length + ' preguntas por responder.';
      form.querySelector('.survey-question.missing')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ answers, at: Date.now() })); }
    catch { error.hidden = false; error.textContent = 'Tu navegador no permite guardar las respuestas (modo privado). Ábrela en una ventana normal e inténtalo de nuevo.'; return; }
    location.href = '/checkout.html?encuesta=1';
  });

  // Estado de la encuesta (activa o no, monto del cupón y compra mínima), sin sesión.
  (async () => {
    const base = String(cfg.url || '').replace(/\/$/, ''), key = cfg.publishableKey;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || !key) return;
    try {
      const res = await fetch(base + '/rest/v1/rpc/survey_info', { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) return;
      const info = await res.json();
      if (!info || typeof info !== 'object') return;
      if (info.enabled === false) { form.hidden = true; $('#surveyClosed').hidden = false; return; }
      if (Number(info.amount) > 0) document.querySelectorAll('[data-survey-amount]').forEach(el => { el.textContent = money(info.amount); });
      if (Number(info.min_subtotal) > 0) { const min = $('#surveyMinimum'); min.hidden = false; min.textContent = 'El cupón aplica en compras desde ' + money(info.min_subtotal) + '.'; }
    } catch { /* sin conexión: la encuesta sigue disponible */ }
  })();
})();
