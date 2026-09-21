'use strict';
// Resumen de ventas del panel: convierte la lista de pedidos y de cuentas en cifras (sin pantalla, para poder probarlo).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EliteSales = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Cuentan como venta los pedidos que la tienda ya confirmó; "nuevo" queda por confirmar y "cancelado" no suma.
  const SOLD = ['confirmado', 'preparando', 'enviado', 'entregado'];
  const norm = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const statusOf = order => norm(order.status) || 'nuevo';

  // El total del pedido es un texto ("RD$7,500"): se toma el primer monto escrito.
  function amountOf(order) {
    const match = String(order.amount || '').match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
    return match ? Number(match[0].replace(/,/g, '')) || 0 : 0;
  }

  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const dayKey = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

  // Rango del período elegido y el período anterior de igual duración (para comparar).
  function periodRange(period, now = new Date()) {
    const today = startOfDay(now), end = addDays(today, 1);
    if (period === 'all') return { start: null, end, prevStart: null, prevEnd: null, days: null };
    const days = period === 'today' ? 1 : Number(period) || 30;
    const start = addDays(today, -(days - 1));
    return { start, end, prevStart: addDays(start, -days), prevEnd: start, days };
  }
  const inRange = (order, from, to) => {
    const time = Date.parse(order.created_at);
    if (Number.isNaN(time)) return false;
    return (!from || time >= from.getTime()) && (!to || time < to.getTime());
  };

  function totals(orders) {
    const sold = orders.filter(o => SOLD.includes(statusOf(o)));
    const pending = orders.filter(o => statusOf(o) === 'nuevo');
    const sales = sold.reduce((sum, o) => sum + amountOf(o), 0);
    return {
      received: orders.length, soldCount: sold.length, sales, average: sold.length ? Math.round(sales / sold.length) : 0,
      pendingCount: pending.length, pendingAmount: pending.reduce((sum, o) => sum + amountOf(o), 0),
      cancelled: orders.filter(o => statusOf(o) === 'cancelado').length,
    };
  }

  // Líneas de un pedido: "2x Nombre (100 ML)" o texto libre. Devuelve [{ name, qty }].
  function parseItems(text) {
    const result = [];
    for (const raw of String(text || '').split(/\r?\n|;/)) {
      let line = raw.trim();
      if (!line) continue;
      let qty = 1;
      const lead = line.match(/^(\d{1,2})\s*[x×*]\s*(.+)$/i);
      if (lead) { qty = Number(lead[1]) || 1; line = lead[2]; }
      else line = line.replace(/^[-•·]\s*/, '');
      line = line.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[·|]\s*\d+\s*ml.*$/i, '').trim();
      if (line) result.push({ name: line.slice(0, 90), qty });
    }
    return result;
  }

  function topProducts(orders, limit = 10) {
    const map = new Map();
    for (const order of orders) {
      if (statusOf(order) === 'cancelado') continue;
      const seen = new Set();
      for (const { name, qty } of parseItems(order.items)) {
        const key = norm(name);
        const entry = map.get(key) || { name, units: 0, orders: 0 };
        entry.units += qty;
        if (!seen.has(key)) { entry.orders += 1; seen.add(key); }
        map.set(key, entry);
      }
    }
    return [...map.values()].sort((a, b) => (b.units - a.units) || (b.orders - a.orders) || a.name.localeCompare(b.name, 'es')).slice(0, limit);
  }

  // Pedidos y ventas por día (los cancelados no se cuentan). En "todo" se muestran como máximo los últimos 90 días.
  function byDay(orders, range, now = new Date()) {
    const end = addDays(startOfDay(now), 0);
    let start = range.start;
    if (!start) {
      const times = orders.map(o => Date.parse(o.created_at)).filter(t => !Number.isNaN(t));
      const first = times.length ? startOfDay(new Date(Math.min(...times))) : end;
      start = first < addDays(end, -89) ? addDays(end, -89) : first;
    }
    const days = [], index = new Map();
    for (let d = start; d <= end; d = addDays(d, 1)) { const key = dayKey(d); index.set(key, days.length); days.push({ date: key, label: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), orders: 0, sales: 0 }); }
    for (const order of orders) {
      if (statusOf(order) === 'cancelado') continue;
      const time = Date.parse(order.created_at);
      if (Number.isNaN(time)) continue;
      const slot = index.get(dayKey(new Date(time)));
      if (slot === undefined) continue;
      days[slot].orders += 1;
      if (SOLD.includes(statusOf(order))) days[slot].sales += amountOf(order);
    }
    return days;
  }

  // Nombre legible del origen de una cuenta (guardado al registrarse: fuente = sitio de donde venía, o "directo").
  function originName(origin) {
    if (!origin || typeof origin !== 'object') return 'Sin datos';
    const source = norm((origin.utm && origin.utm.source) || origin.fuente);
    if (!source) return 'Sin datos';
    if (source === 'directo') return 'Directo (escribió la dirección o la guardó)';
    if (/sin consentimiento/.test(source)) return 'Sin permiso de cookies';
    const known = [[/instagram|ig\b/, 'Instagram'], [/facebook|fb\b|fb\./, 'Facebook'], [/whatsapp|wa\.me/, 'WhatsApp'], [/tiktok/, 'TikTok'], [/youtube|youtu\.be/, 'YouTube'], [/google/, 'Google'], [/bing/, 'Bing'], [/duckduckgo/, 'DuckDuckGo'], [/(^|\.)t\.co$|twitter|(^|\.)x\.com$/, 'X / Twitter']];
    for (const [pattern, name] of known) if (pattern.test(source)) return name;
    return source.replace(/^www\./, '').slice(0, 40);
  }

  function origins(customers) {
    const map = new Map();
    for (const c of customers || []) {
      const name = originName(c.origen), entry = map.get(name) || { name, accounts: 0, buyers: 0, orders: 0 };
      entry.accounts += 1; const n = Number(c.pedidos) || 0; if (n > 0) entry.buyers += 1; entry.orders += n;
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => (b.accounts - a.accounts) || a.name.localeCompare(b.name, 'es'));
  }

  function summarize(orders, customers, options = {}) {
    const now = options.now || new Date(), period = options.period || '30';
    const range = periodRange(period, now);
    const current = orders.filter(o => inRange(o, range.start, range.end));
    const previous = range.prevStart ? orders.filter(o => inRange(o, range.prevStart, range.prevEnd)) : null;
    return { period, range, totals: totals(current), previous: previous ? totals(previous) : null, days: byDay(current, range, now), top: topProducts(current), origins: origins(customers) };
  }

  // Variación porcentual respecto al período anterior; null si no hay con qué comparar.
  const change = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

  return { SOLD, amountOf, periodRange, totals, parseItems, topProducts, byDay, originName, origins, summarize, change };
});
