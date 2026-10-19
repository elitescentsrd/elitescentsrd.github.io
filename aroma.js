'use strict';
// "Encuentra tu perfume": clasifica las notas olfativas de cada perfume en familias de aroma y recomienda según las respuestas.
// Es código puro (sin pantalla): tienda.js dibuja el asistente y las pruebas lo ejecutan con los 420 perfumes reales.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EliteAroma = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const norm = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const numbers = value => (String(value).match(/[0-9][0-9,.]*/g) || []).map(v => Number(v.replace(/[,.]/g, ''))).filter(Number.isFinite);

  const FAMILIES = {
    fresco: { label: 'Fresco y cítrico', hint: 'limón, bergamota, menta, lavanda, notas marinas' },
    dulce: { label: 'Dulce y cremoso', hint: 'vainilla, caramelo, haba tonka, chocolate' },
    frutal: { label: 'Frutal', hint: 'manzana, piña, durazno, frutos rojos' },
    floral: { label: 'Floral', hint: 'rosa, jazmín, flor de azahar, peonía' },
    amaderado: { label: 'Amaderado y ámbar', hint: 'sándalo, cedro, pachulí, ámbar, oud' },
    especiado: { label: 'Especiado e intenso', hint: 'pimienta, canela, azafrán, cuero, tabaco' },
  };

  // Icono de cada familia (trazos SVG de 24×24, constantes): la pirámide de notas de la ficha y de la página del perfume.
  const ICONS = {
    fresco: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
    dulce: '<path d="M12 3.5c3.2 4.6 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.8-6.4 6-11z"/><path d="M9.5 15.5a2.6 2.6 0 0 0 2.5 2"/>',
    frutal: '<path d="M12 7.5c-2.2-1.6-6.4-1-6.9 3.6C4.6 15.6 7.6 20.5 9.8 20.5c1 0 1.4-.6 2.2-.6s1.2.6 2.2.6c2.2 0 5.2-4.9 4.7-9.4C18.4 6.5 14.2 5.9 12 7.5z"/><path d="M12 7.5c0-2 1-3.6 3.2-4.2"/>',
    floral: '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8C10 6 10.5 3.5 12 3.5s2 2.5 0 6.3zM14.2 12c3.8-2 6.3-1.5 6.3 0s-2.5 2-6.3 0zM12 14.2c2 3.8 1.5 6.3 0 6.3s-2-2.5 0-6.3zM9.8 12C6 14 3.5 13.5 3.5 12s2.5-2 6.3 0z"/>',
    amaderado: '<path d="M12 3 6 14h12z"/><path d="M12 14v7M9 21h6"/>',
    especiado: '<path d="M12 21a6 6 0 0 0 6-6c0-4.2-3-6.2-4.2-10.5C12.4 6.6 12 8.2 12 9.8c-1-.9-1.6-2-1.7-3.2C7.9 8.9 6 11.6 6 15a6 6 0 0 0 6 6z"/>',
    otra: '<circle cx="12" cy="12" r="3.2"/>',
  };

  // El orden importa: la primera regla que coincide decide la familia de la nota ("pimienta rosa" es especiada, no floral).
  const RULES = [
    ['especiado', /\b(?:pimienta|pepper|paprika|pimiento|canela|cinnamon|cardamom|cardamon|jengibre|ginger|azafran|saffron|nuez moscada|nutmeg|clavo|clove|comino|cumin|anis|anise|curcuma|turmeric|especia|spice|regaliz|licorice|alcaravea|caraway|tabaco|tobacco|cuero|leather|gamuza|suede|humo|smoke|ron\b|rum\b|whisk|conac|cognac|licor|liquor|vodka|sake\b|absenta|absinthe|oriental)/],
    ['dulce', /\b(?:vainilla|vanilla|vanille|vanila|tonka|caramel|acaramel|praline|toffee|azucar|sugar|miel\b|honey|chocolate|cacao|cocoa|cocoapulse|cafe\b|coffee|crema|cremos|cream|creme|champ|frutos secos|leche|milk|mantequilla|butter|almendra|almond|amaretto|pistach|avellana|hazelnut|castana|chestnut|malvavisco|marshmallow|meringue|merengue|cookie|biscuit|galleta|cupcake|macaron|brioche|frosting|popcorn|panacotta|candy|cotton|bubble gum|sorbet|ice cream|dulce|sweet|gourmand|datil|dates\b|maple|jarabe|syrup|nougat|lactone)/],
    ['frutal', /\b(?:manzana|apple|pina\b|pineapple|pera\b|pear|durazno|peach|melocoton|grosella|currant|cassis|frambuesa|raspberry|ciruela|plum|lichi|litchi|fresa\b|strawberry|melon|mango|maracuya|passion|sandia|watermelon|pitahaya|granada|pomegranate|cereza|cherry|higo|fig\b|albaricoque|apricot|arandano|cranberry|mora\b|blackberry|kiwi|guayaba|guava|banana|platano|membrillo|quince|fruta|fruit|tropical|frutos rojos|mirabelle|ruibarbo|rhubarb|coco\b|coconut|nashi)/],
    ['floral', /\b(?:rosa\b|rosas\b|rose\b|roses\b|rosyfolia|jazmin|jasmine|jasmin|flor\b|flores\b|floral|flower|blossom|azahar|peonia|peony|lirio|lily|iris\b|orris|violeta|violet|magnolia|orquidea|orchid|gardenia|fresia|freesia|neroli|ylang|nardo|tuberosa|tuberose|geranio|geranium|heliotropo|heliotrope|mimosa|clavel|ciclamen|cyclamen|loto\b|lotus|nenufar|frangipani|tiare|narcissus|narciso|marigold|camomila|chamomile|lila\b|lilac|hibisco|hibiscus|acacia|osmanthus|camelia|camellia|empolvad|powder)/],
    ['amaderado', /\b(?:sandalo|sandal|cedro|cedar|vetiver|pachuli|patchouli|madera|maderas|wood|woods|akigalawood|driftwood|guayaco|guaiac|abedul|birch|caoba|mahogany|papiro|papyrus|palo santo|cade\b|roble|oak\b|musgo|moss|ambar|amber|ambroxan|ambrofix|oud|agarwood|incienso|frankincense|olibano|benjui|benzoin|ladano|labdanum|resina|resin|mirra|myrrh|elemi|balsam|balsamo|gurjan|cipres|cypress|pino\b|pine\b|abeto|amyris|kingwood|earthy|tierra|civet|cachemira|cashmere)/],
    ['fresco', /\b(?:bergamota|bergamot|limon|lemon|lima\b|lime\b|mandarina|mandarin|tangerine|naranja|orange|toronja|grapefruit|pomelo|citric|citrus|citron|yuzu|kumquat|petitgrain|menta|mint|marin|acuatic|aquatic|agua|water|ozonic|ozono|aquozone|calone|alga\b|algas|seaweed|lavanda|lavender|salvia|sage\b|romero|rosemary|albahaca|basil|artemisa|artemisia|estragon|tarragon|enebro|juniper|cilantro|coriander|pepino|cucumber|verde|green|hierba|herb|bamboo|bambu|te\b|tea\b|helad|icy|fresh|fresc|solar|mineral|arena\b|sand\b|salt|sal\b|leaf|leaves|davana|aromatic|oregano|mirto|myrtle|soap|jabon|ivy|hiedra|galbanum)/],
  ];

  const cache = new Map();
  function familyOf(note) {
    const key = norm(note);
    if (cache.has(key)) return cache.get(key);
    let found = null;
    for (const [family, pattern] of RULES) if (pattern.test(key)) { found = family; break; }
    cache.set(key, found);
    return found;
  }

  // Cuántas notas de cada familia tiene un perfume (salida, corazón y fondo) y cuáles son.
  function profile(product) {
    const notes = [...(product.notes_top || []), ...(product.notes_heart || []), ...(product.notes_base || [])];
    const counts = {}, matched = {};
    for (const note of notes) {
      const family = familyOf(note);
      if (!family) continue;
      counts[family] = (counts[family] || 0) + 1;
      (matched[family] = matched[family] || []).push(note);
    }
    return { total: notes.length, counts, matched };
  }
  const familiesOf = product => Object.entries(profile(product).counts).sort((a, b) => b[1] - a[1]).map(([family]) => family);

  const STEPS = [
    { id: 'who', title: '¿Para quién es el perfume?', help: '', multi: false, options: [
      { value: 'hombre', label: 'Para él', hint: 'Incluye fragancias unisex' },
      { value: 'mujer', label: 'Para ella', hint: 'Incluye fragancias unisex' },
      { value: 'todos', label: 'Me da igual', hint: 'Veo todo el catálogo' } ] },
    { id: 'occasion', title: '¿Cuándo lo vas a usar más?', help: '', multi: false, options: [
      { value: 'diario', label: 'Día a día y trabajo' },
      { value: 'noche', label: 'Noche y salidas' },
      { value: 'cita', label: 'Citas y momentos especiales' },
      { value: 'calor', label: 'Clima caluroso' },
      { value: 'cualquiera', label: 'Cualquier ocasión' } ] },
    { id: 'families', title: '¿Qué aromas te atraen?', help: 'Elige hasta 2, o pulsa "No lo sé" y te sugerimos según la ocasión.', multi: true, max: 2, options: [
      ...Object.entries(FAMILIES).map(([value, info]) => ({ value, label: info.label, hint: info.hint })),
      { value: 'ninguno', label: 'No lo sé', hint: 'Sorpréndeme', exclusive: true } ] },
    { id: 'budget', title: '¿Cuál es tu presupuesto?', help: 'Se compara con el precio del perfume.', multi: false, options: [
      { value: '3000', label: 'Hasta RD$3,000' },
      { value: '5000', label: 'Hasta RD$5,000' },
      { value: '7000', label: 'Hasta RD$7,000' },
      { value: 'sin', label: 'Sin límite' } ] },
  ];

  // Cuánto pesa cada familia según la ocasión (afina el orden; lo que el cliente elige pesa más).
  const OCCASION = {
    diario: { fresco: 3, frutal: 1, floral: 1, amaderado: 1 },
    noche: { especiado: 3, amaderado: 3, dulce: 2 },
    cita: { dulce: 3, floral: 2, amaderado: 2, especiado: 1 },
    calor: { fresco: 3, frutal: 2, floral: 1 },
    cualquiera: {},
  };

  const minPrice = product => { const values = numbers(product.price); return values.length ? Math.min(...values) : Infinity; };

  // answers = { who, occasion, families: [], budget }. Devuelve { items: [{ product, score, reasons }], total }.
  function recommend(products, answers = {}, limit = 6) {
    const families = (answers.families || []).filter(f => FAMILIES[f]);
    const weights = OCCASION[answers.occasion] || {};
    const scale = families.length ? 1 : 3;
    const maxBudget = /^\d+$/.test(String(answers.budget || '')) ? Number(answers.budget) : Infinity;
    const wanted = answers.who === 'hombre' ? ['hombre', 'unisex'] : answers.who === 'mujer' ? ['mujer', 'unisex'] : null;
    const candidates = [];
    products.forEach((product, index) => {
      if (product.availability === 'agotado') return;
      if (wanted && !wanted.includes(product.gender)) return;
      if (minPrice(product) > maxBudget) return;
      const { total, counts, matched } = profile(product);
      let score = 0;
      const reasons = [];
      for (const family of Object.keys(FAMILIES)) {
        const share = total ? (counts[family] || 0) / total : 0;
        if (families.includes(family) && counts[family]) { score += 10 * share + 2; reasons.push({ family, label: FAMILIES[family].label, notes: matched[family].slice(0, 3) }); }
        if (weights[family]) { score += weights[family] * share * scale; if (!families.length && counts[family] && reasons.length < 2) reasons.push({ family, label: FAMILIES[family].label, notes: matched[family].slice(0, 3) }); }
      }
      candidates.push({ product, score, reasons, index });
    });
    const asked = families.length > 0 || (answers.occasion && answers.occasion !== 'cualquiera');
    const pool = candidates.filter(c => !asked || c.score > 0);
    pool.sort((a, b) => (b.score - a.score) || ((a.product.availability === 'disponible' ? 0 : 1) - (b.product.availability === 'disponible' ? 0 : 1)) || (a.index - b.index));
    // Variedad: como máximo 2 perfumes por marca en la lista (se completa con el resto si hace falta).
    const picked = [], perBrand = new Map();
    for (const item of pool) {
      if (picked.length >= limit) break;
      const brand = item.product.brand || '';
      if (brand && (perBrand.get(brand) || 0) >= 2) continue;
      perBrand.set(brand, (perBrand.get(brand) || 0) + 1); picked.push(item);
    }
    for (const item of pool) { if (picked.length >= limit) break; if (!picked.includes(item)) picked.push(item); }
    return { items: picked.map(({ product, score, reasons }) => ({ product, score, reasons })), total: pool.length };
  }

  // Resumen en una frase de lo que eligió el cliente (para el mensaje de WhatsApp).
  function describeAnswers(answers = {}) {
    const parts = [];
    if (answers.who === 'hombre') parts.push('para él'); else if (answers.who === 'mujer') parts.push('para ella');
    const occasions = { diario: 'para el día a día', noche: 'para noche y salidas', cita: 'para citas y momentos especiales', calor: 'para clima caluroso' };
    if (occasions[answers.occasion]) parts.push(occasions[answers.occasion]);
    const families = (answers.families || []).filter(f => FAMILIES[f]).map(f => FAMILIES[f].label.toLowerCase());
    if (families.length) parts.push('que se incline a lo ' + families.join(' y a lo '));
    if (/^\d+$/.test(String(answers.budget || ''))) parts.push('hasta RD$' + Number(answers.budget).toLocaleString('en-US'));
    return parts.join(', ');
  }

  return { FAMILIES, ICONS, RULES, STEPS, OCCASION, familyOf, profile, familiesOf, recommend, describeAnswers, minPrice };
});
