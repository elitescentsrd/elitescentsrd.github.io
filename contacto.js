'use strict';
// Formulario de «Contacto»: el mensaje llega a la sección «Mensajes» del panel (función send_contact_message de la base
// de datos, que valida los datos y pone los límites). No se envía nada a terceros. Si no se puede enviar, se ofrece
// mandar el mismo mensaje por WhatsApp para que el cliente nunca se quede sin respuesta.
(() => {
  const form = document.getElementById('contactForm');
  if (!form) return;
  const cfg = window.ELITE_SUPABASE || {};
  const base = String(cfg.url || '').replace(/\/$/, ''), key = cfg.publishableKey || '';
  const $ = id => document.getElementById(id);
  const status = $('contactStatus'), send = $('contactSend'), count = $('contactCount'), done = $('contactDone');
  const { name, phone, topic, message } = form.elements;
  const topics = { perfume: 'un perfume', pedido: 'un pedido', envio: 'envíos y pagos', otro: '' };

  // Si llega desde la página de un perfume (contacto.html?perfume=Nombre), el mensaje empieza con ese perfume.
  const asked = new URLSearchParams(location.search).get('perfume');
  if (asked && asked.length <= 120) { topic.value = 'perfume'; message.value = 'Hola, quiero información de ' + asked + '. '; }

  const updateCount = () => { count.textContent = message.value.length.toLocaleString('en-US') + ' / 1,000'; };
  message.addEventListener('input', updateCount); updateCount();

  function setStatus(text, kind, extra) {
    status.className = 'contact-status' + (kind ? ' ' + kind : '');
    status.replaceChildren(text);
    if (extra) status.append(' ', extra);
  }
  function invalid(field, text) {
    field.setAttribute('aria-invalid', 'true'); field.focus();
    setStatus(text, 'error');
    return false;
  }
  // Al corregir el dato que estaba mal, el aviso se va.
  form.addEventListener('input', e => {
    if (e.target.getAttribute?.('aria-invalid') !== 'true') return;
    e.target.removeAttribute('aria-invalid');
    if (status.classList.contains('error')) setStatus('');
  });

  // Las mismas reglas de la base de datos, para avisar antes de enviar.
  function check() {
    const n = name.value.trim().replace(/\s+/g, ' '), text = message.value.trim();
    if (n.length < 2 || n.length > 80 || /[<>{}]/.test(n) || !/\p{L}/u.test(n)) return invalid(name, 'Escribe tu nombre (de 2 a 80 letras).');
    const raw = phone.value.trim();
    let digits = raw.replace(/\D/g, '');
    if (raw.startsWith('00')) digits = digits.slice(2);
    if (!/^1?(809|829|849)\d{7}$/.test(digits) && !(/^(\+|00)/.test(raw) && /^[1-9]\d{7,14}$/.test(digits)))
      return invalid(phone, 'Escribe tu WhatsApp: 10 dígitos si es de República Dominicana (809, 829 u 849), o con + y el código del país si es de otro país.');
    if (text.length < 5 || text.length > 1000) return invalid(message, 'Escribe tu mensaje (de 5 a 1,000 letras).');
    return true;
  }

  // Plan B: el mismo mensaje, listo para enviarlo por WhatsApp.
  function whatsappLink() {
    const a = document.createElement('a');
    a.className = 'text-underline'; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const about = topics[topic.value] ? ' (sobre ' + topics[topic.value] + ')' : '';
    a.href = 'https://wa.me/18094333348?text=' + encodeURIComponent('Hola Elite Scents RD, soy ' + name.value.trim() + about + '. ' + message.value.trim());
    a.textContent = 'Enviarlo por WhatsApp ↗';
    return a;
  }

  function finish(text) {
    form.hidden = true;
    $('contactDoneText').textContent = text;
    done.hidden = false; done.focus();
  }

  let sending = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    // Trampa para robots: una persona nunca ve ni llena este campo.
    if (String(form.elements.website?.value || '').trim()) { finish('Listo: recibimos tu mensaje.'); return; }
    if (!check()) return;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || !key) { setStatus('No se pudo enviar desde aquí.', 'error', whatsappLink()); return; }
    sending = true; send.disabled = true; setStatus('Enviando…');
    try {
      const res = await fetch(base + '/rest/v1/rpc/send_contact_message', {
        method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_name: name.value, p_phone: phone.value, p_topic: topic.value, p_message: message.value }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out || typeof out.ok !== 'boolean') throw new Error('HTTP ' + res.status);
      if (out.ok) finish(out.message || 'Listo: recibimos tu mensaje y te responderemos por WhatsApp.');
      else setStatus(out.message || 'Revisa los datos e inténtalo de nuevo.', 'error');
    } catch {
      setStatus('No se pudo enviar en este momento.', 'error', whatsappLink());
    } finally { sending = false; send.disabled = false; }
  });

  $('contactAgain').addEventListener('click', () => {
    message.value = ''; updateCount(); setStatus('');
    done.hidden = true; form.hidden = false; message.focus();
  });
})();
