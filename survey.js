'use strict';
// Encuesta de clientes: las preguntas (una sola lista para la página /encuesta.html y para el panel) y utilidades sin pantalla.
// Para cambiar una pregunta, edítala aquí: la página y los resultados del panel se actualizan solos.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EliteSurvey = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // type: single (una opción), multi (varias, hasta max), text (línea corta), longtext (párrafo).
  // Límites que también revisa la base de datos: id en minúsculas y guion bajo, textos de hasta 300 letras, opciones de hasta 80.
  const QUESTIONS = [
    { id: 'para_quien', text: '¿Para quién compras perfumes normalmente?', type: 'single', required: true, options: ['Para mí', 'Para regalar', 'Las dos cosas'] },
    { id: 'aromas', text: '¿Qué aromas te gustan?', help: 'Elige hasta 3.', type: 'multi', max: 3, required: true, options: ['Frescos y cítricos', 'Dulces', 'Frutales', 'Florales', 'Amaderados', 'Especiados e intensos', 'No sé todavía'] },
    { id: 'ocasion', text: '¿Cuándo usas más tu perfume?', type: 'single', required: true, options: ['Día a día y trabajo', 'Noche y salidas', 'Citas y eventos', 'Siempre'] },
    { id: 'presupuesto', text: '¿Cuánto sueles gastar en un perfume?', type: 'single', required: true, options: ['Menos de RD$3,000', 'RD$3,000–5,000', 'RD$5,000–7,000', 'Más de RD$7,000'] },
    { id: 'favorito', text: '¿Cuál es tu perfume o marca favorita?', help: 'Opcional.', type: 'text', max: 120, required: false },
    { id: 'como_nos_conociste', text: '¿Cómo nos conociste?', type: 'single', required: true, options: ['Instagram', 'WhatsApp', 'Google', 'Me lo recomendaron', 'Otro'] },
    { id: 'mejorar', text: '¿Qué te gustaría que mejoremos o que traigamos?', help: 'Opcional.', type: 'longtext', max: 300, required: false },
  ];

  // Limpia lo que llega del formulario: solo preguntas conocidas y opciones válidas. Devuelve { answers, missing }.
  function clean(raw) {
    const answers = {}, missing = [];
    for (const q of QUESTIONS) {
      const value = raw ? raw[q.id] : undefined;
      if (q.type === 'single') {
        const v = q.options.includes(value) ? value : '';
        if (v) answers[q.id] = v; else if (q.required) missing.push(q.id);
      } else if (q.type === 'multi') {
        const list = [...new Set((Array.isArray(value) ? value : []).filter(v => q.options.includes(v)))].slice(0, q.max || q.options.length);
        if (list.length) answers[q.id] = list; else if (q.required) missing.push(q.id);
      } else {
        const v = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, q.max || 300);
        if (v) answers[q.id] = v; else if (q.required) missing.push(q.id);
      }
    }
    return { answers, missing };
  }

  // Resultados para el panel: conteo por opción en las preguntas de elegir y las respuestas escritas más recientes.
  function tally(responses) {
    const list = (responses || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return QUESTIONS.map(q => {
      if (q.type === 'single' || q.type === 'multi') {
        const counts = new Map(q.options.map(o => [o, 0]));
        let answered = 0;
        for (const r of list) {
          const v = r.answers ? r.answers[q.id] : undefined, values = Array.isArray(v) ? v : v ? [v] : [];
          if (values.length) answered += 1;
          for (const item of values) counts.set(item, (counts.get(item) || 0) + 1);
        }
        return { id: q.id, text: q.text, type: q.type, answered, options: [...counts].map(([label, count]) => ({ label, count, percent: answered ? Math.round((count / answered) * 100) : 0 })) };
      }
      const texts = list.filter(r => r.answers && String(r.answers[q.id] || '').trim()).map(r => ({ text: String(r.answers[q.id]).trim(), date: r.created_at }));
      return { id: q.id, text: q.text, type: q.type, answered: texts.length, texts };
    });
  }

  // Celda de CSV segura para Excel: comillas escapadas y sin fórmulas (un texto que empieza con = + - @ no se ejecuta).
  function csvCell(value) {
    let s = String(value == null ? '' : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(responses) {
    const header = ['Fecha', 'Cupón'].concat(QUESTIONS.map(q => q.text));
    const rows = (responses || []).map(r => [String(r.created_at || '').slice(0, 16).replace('T', ' '), r.coupon_code || '']
      .concat(QUESTIONS.map(q => { const v = r.answers ? r.answers[q.id] : ''; return Array.isArray(v) ? v.join('; ') : (v || ''); })));
    return '﻿' + [header].concat(rows).map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  return { QUESTIONS, clean, tally, csvCell, toCsv };
});
