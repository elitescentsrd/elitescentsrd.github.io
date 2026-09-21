(() => {
  'use strict';
  const cfg = window.ELITE_SUPABASE || {};
  const base = String(cfg.url || '').replace(/\/$/, '');
  const key = cfg.publishableKey;
  const tokenKey = 'elite-admin-session-v1';
  const $ = (s, root = document) => root.querySelector(s);
  const loginCard = $('#login-card'), content = $('#admin-content'), logout = $('#logout');
  const loginStatus = $('#login-status'), productStatus = $('#product-status');
  const form = $('#product-form'), productsBody = $('#products-body'), ordersBody = $('#orders-body');
  let session = null, products = [], orders = [], productQuery = '', knownOrderIds = new Set(), orderPoll = null;

  function status(el, message, kind = '') { el.textContent = message; el.className = kind; }
  function normalizeArray(value) { return String(value || '').split(/[\n,]/).map(v => v.trim()).filter(Boolean); }
  function money(value) { return 'RD$' + new Intl.NumberFormat('es-DO').format(Number(String(value).replace(/[^0-9.]/g, '')) || 0); }
  // Conserva presentaciones múltiples ("RD$3,550 / RD$4,150"): antes se concatenaban en un solo número.
  function normalizePrice(value) {
    const amounts = (String(value || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(v => Number(v.replace(/,/g, ''))).filter(n => Number.isFinite(n) && n > 0);
    return amounts.length ? amounts.map(money).join(' / ') : '';
  }
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024, MIN_IMAGE_SIDE = 500, BATCH_MAX = 36;
  function authHeaders(json = true) {
    const headers = { apikey: key, Authorization: 'Bearer ' + session.access_token };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }
  async function parse(res) {
    const body = await res.text(); let data = null;
    try { data = body ? JSON.parse(body) : null; } catch { data = body; }
    if (!res.ok) throw new Error((data && (data.message || data.error_description || data.error)) || 'Error ' + res.status);
    return data;
  }
  // La sesión de Supabase dura ~1 hora: al recibir 401 se renueva con el refresh token para que el panel
  // siga avisando de pedidos nuevos durante todo el día sin volver a iniciar sesión.
  async function refreshSession() {
    if (!session?.refresh_token) return false;
    try {
      const res = await fetch(base + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      if (!res.ok) return false;
      const data = await res.json(); saveSession({ ...data, user: data.user || session.user }); return true;
    } catch { return false; }
  }
  async function api(path, options = {}) {
    const send = () => fetch(base + path, { ...options, headers: { ...authHeaders(options.json !== false), ...(options.headers || {}) } });
    let res = await send();
    if (res.status === 401 && !path.startsWith('/auth/v1/logout') && await refreshSession()) res = await send();
    return parse(res);
  }
  function saveSession(data) {
    session = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user };
    sessionStorage.setItem(tokenKey, JSON.stringify(session));
  }
  async function isAdmin() {
    const rows = await api('/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(session.user.id));
    return Array.isArray(rows) && rows.length === 1;
  }
  // --- Verificación en dos pasos (TOTP): obligatoria para entrar al panel. ---
  const mfaCard = $('#mfa-card'), mfaSetupCard = $('#mfa-setup-card');
  let mfaFactorId = null, mfaEnrollId = null;
  function jwtAal(token) {
    try { return JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch { return 'aal1'; }
  }
  // Supabase entrega el QR como SVG (a veces dentro de una URL data: sin codificar): se normaliza para que el <img> lo dibuje.
  function qrSource(qr) {
    const s = String(qr || ''), i = s.indexOf('<svg');
    if (i >= 0) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.slice(i));
    return /^data:image\//i.test(s) ? s : '';
  }
  function friendlyAuth(message) {
    const m = String(message || '');
    if (/invalid totp|mfa verification|verification failed/i.test(m)) return 'Código incorrecto o vencido. Escribe el código actual de tu app.';
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    return m;
  }
  function resetToLogin() {
    sessionStorage.removeItem(tokenKey); session = null; mfaFactorId = null; mfaEnrollId = null;
    mfaCard.classList.add('hidden'); mfaSetupCard.classList.add('hidden'); loginCard.classList.remove('hidden');
    $('#login-form').elements.password.value = '';
  }
  // Tras la contraseña: comprueba que sea administrador y exige el segundo paso (código o activación).
  async function gate() {
    if (!(await isAdmin())) throw new Error('Esta cuenta no tiene permisos de administración.');
    const user = await api('/auth/v1/user', { method: 'GET' });
    session.user = user; saveSession({ access_token: session.access_token, refresh_token: session.refresh_token, user });
    const factor = (user.factors || []).find(f => f.factor_type === 'totp' && f.status === 'verified');
    if (factor && jwtAal(session.access_token) === 'aal2') return showAdmin();
    loginCard.classList.add('hidden');
    if (factor) { mfaFactorId = factor.id; mfaCard.classList.remove('hidden'); $('#mfa-form').elements.code.value = ''; $('#mfa-form').elements.code.focus(); status($('#mfa-status'), ''); return; }
    await startMfaSetup();
  }
  async function startMfaSetup() {
    mfaSetupCard.classList.remove('hidden'); status($('#mfa-setup-status'), 'Preparando…');
    // Un intento anterior sin terminar deja un factor sin verificar que bloquea uno nuevo.
    for (const f of (session.user.factors || [])) if (f.factor_type === 'totp' && f.status !== 'verified') await api('/auth/v1/factors/' + encodeURIComponent(f.id), { method: 'DELETE' }).catch(() => {});
    const data = await api('/auth/v1/factors', { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Panel Elite Scents ' + Date.now().toString(36) }) });
    mfaEnrollId = data.id;
    const img = $('#mfa-qr'), src = qrSource(data.totp?.qr_code);
    img.classList.toggle('hidden', !src); if (src) img.src = src;
    img.onerror = () => { img.classList.add('hidden'); };
    const uri = String(data.totp?.uri || ''), link = $('#mfa-link');
    if (/^otpauth:\/\//i.test(uri)) { link.href = uri; link.classList.remove('hidden'); } else link.classList.add('hidden');
    $('#mfa-secret').textContent = data.totp?.secret || ''; $('#mfa-setup-form').elements.code.value = '';
    status($('#mfa-setup-status'), 'Escanea el QR (o usa la clave manual) y escribe el código de tu app.');
  }
  async function verifyMfa(factorId, code) {
    if (!/^\d{6,8}$/.test(code)) throw new Error('Escribe el código de 6 dígitos de tu app.');
    const id = encodeURIComponent(factorId);
    const challenge = await api('/auth/v1/factors/' + id + '/challenge', { method: 'POST', body: '{}' });
    const verified = await api('/auth/v1/factors/' + id + '/verify', { method: 'POST', body: JSON.stringify({ challenge_id: challenge.id, code }) });
    saveSession({ ...verified, user: verified.user || session.user });
    showAdmin();
  }
  async function restore() {
    try {
      session = JSON.parse(sessionStorage.getItem(tokenKey));
      if (!session?.access_token) return;
      await gate();
    } catch { sessionStorage.removeItem(tokenKey); session = null; }
  }
  function showAdmin() {
    mfaCard.classList.add('hidden'); mfaSetupCard.classList.add('hidden');
    loginCard.classList.add('hidden'); content.classList.remove('hidden'); logout.classList.remove('hidden');
    loadAll().then(()=>{knownOrderIds=new Set(orders.map(o=>String(o.id)));});
    loadCustomers();
    if(!orderPoll) orderPoll=setInterval(checkNewOrders,20000);
  }
  // Pedidos sin atender (estado "nuevo"): contador visible y en el título de la pestaña.
  function updatePending() {
    const pending=orders.filter(o=>(o.status||'nuevo')==='nuevo').length;
    const label=$('#pending-count');
    if(label){label.textContent=pending?pending+(pending===1?' pedido nuevo por atender':' pedidos nuevos por atender'):'No hay pedidos nuevos por atender.';label.classList.toggle('has-pending',pending>0)}
    document.title=(pending?'('+pending+') ':'')+'Panel | Elite Scents RD';
  }
  // Sonido corto de aviso (el navegador solo permite audio después de que hayas hecho clic en la página).
  function beep() {
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
      const ctx=new Ctx(),now=ctx.currentTime;
      [[880,0],[1175,0.22]].forEach(([freq,delay])=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=freq;osc.connect(gain);gain.connect(ctx.destination);gain.gain.setValueAtTime(0.0001,now+delay);gain.gain.exponentialRampToValueAtTime(0.25,now+delay+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,now+delay+0.3);osc.start(now+delay);osc.stop(now+delay+0.32)});
      setTimeout(()=>ctx.close(),1000);
    }catch{}
  }
  async function checkNewOrders(){
    if(!session)return;
    try{
      const latest=await api('/rest/v1/orders?select=*&order=created_at.desc&limit=20');
      const fresh=latest.filter(o=>!knownOrderIds.has(String(o.id)));
      latest.forEach(o=>knownOrderIds.add(String(o.id)));
      // Se conservan los pedidos más antiguos ya cargados; los 20 recientes se actualizan (estado, entrega).
      const recent=new Set(latest.map(o=>String(o.id)));
      orders=[...latest,...orders.filter(o=>!recent.has(String(o.id)))];renderOrders();
      if(fresh.length){
        beep();
        if('Notification' in window && Notification.permission==='granted'){
          new Notification('Nuevo pedido - Elite Scents RD',{body:(fresh[0].customer_name||'Cliente')+' realizó un pedido.'});
        }
      }
    }catch{}
  }
  const notifyBtn=$('#enable-order-notifications');
  if(notifyBtn) notifyBtn.addEventListener('click',async()=>{
    if(!('Notification' in window)){alert('Este navegador no admite notificaciones.');return;}
    const permission=await Notification.requestPermission();
    notifyBtn.textContent=permission==='granted'?'Notificaciones activadas':'Activar notificaciones';
  });
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault(); status(loginStatus, 'Verificando…');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(base + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const auth = await parse(res); saveSession(auth);
      status(loginStatus, ''); await gate();
    } catch (err) { resetToLogin(); status(loginStatus, friendlyAuth(err.message), 'error'); }
  });
  $('#mfa-form').addEventListener('submit', async e => {
    e.preventDefault(); status($('#mfa-status'), 'Verificando…');
    try { await verifyMfa(mfaFactorId, String(new FormData(e.currentTarget).get('code')).trim()); }
    catch (err) { status($('#mfa-status'), friendlyAuth(err.message), 'error'); }
  });
  $('#mfa-setup-form').addEventListener('submit', async e => {
    e.preventDefault(); status($('#mfa-setup-status'), 'Verificando…');
    try { await verifyMfa(mfaEnrollId, String(new FormData(e.currentTarget).get('code')).trim()); }
    catch (err) { status($('#mfa-setup-status'), friendlyAuth(err.message), 'error'); }
  });
  $('#mfa-cancel').addEventListener('click', resetToLogin);
  $('#mfa-setup-cancel').addEventListener('click', resetToLogin);
  logout.addEventListener('click', async () => {
    try { await api('/auth/v1/logout', { method: 'POST' }); } catch {}
    if(orderPoll){clearInterval(orderPoll);orderPoll=null;} sessionStorage.removeItem(tokenKey); location.reload();
  });

  async function loadAll() {
    try {
      [products, orders] = await Promise.all([
        api('/rest/v1/products?select=*&order=sort_order.asc,name.asc'),
        api('/rest/v1/orders?select=*&order=created_at.desc')
      ]);
      renderProducts(productQuery?products.filter(p=>(p.name+' '+(p.brand||'')).toLocaleLowerCase('es').includes(productQuery)):products); renderOrders();
      applyOfferUi(); renderOffers();
    } catch (err) { status(productStatus, err.message, 'error'); }
  }
  function renderProducts(list = products) {
    productsBody.replaceChildren(...list.slice(0,6).map(p => {
      const tr = document.createElement('tr');
      const img = document.createElement('img'); img.src = p.image_url || '/logo-oficial.webp'; img.alt = '';
      const cells = [document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td')];
      cells[0].append(img); cells[1].textContent = p.name; cells[2].textContent = p.brand || '—'; cells[3].textContent = p.original_price ? p.price + ' (antes ' + p.original_price + ')' : (p.price || '—');
      cells[4].textContent = p.active === false ? 'Oculto' : (p.availability || 'disponible');
      const edit = document.createElement('button'); edit.type='button'; edit.className='btn btn-secondary'; edit.textContent='Editar'; edit.addEventListener('click',()=>editProduct(p));
      const del = document.createElement('button'); del.type='button'; del.className='btn btn-secondary'; del.textContent='Eliminar'; del.addEventListener('click',()=>deleteProduct(p));
      cells[5].className='admin-actions'; cells[5].append(edit,del); tr.append(...cells); return tr;
    }));
  }
  function orderWhatsapp(o) {
    const eta=o.estimated_delivery?(' Entrega estimada: '+o.estimated_delivery+'.'):'';
    const text='Hola '+(o.customer_name||'')+', recibimos tu pedido #'+o.id+' en Elite Scents RD.'+eta+'\n\n'+(o.items||'')+'\n\nTotal: '+(o.amount||'Por confirmar');
    // wa.me exige el código de país: un número dominicano de 10 dígitos (809/829/849) lleva 1 delante.
    let digits=String(o.phone||'').replace(/\D/g,'');if(digits.length===10)digits='1'+digits;
    return 'https://wa.me/'+digits+'?text='+encodeURIComponent(text);
  }
  function renderOrders() {
    updatePending();
    ordersBody.replaceChildren(...orders.map(o => {
      const tr=document.createElement('tr');
      const date=document.createElement('td');date.textContent=new Date(o.created_at).toLocaleString('es-DO');
      const customer=document.createElement('td');customer.textContent=o.customer_name||'—';
      if(o.cedula) customer.title='Cédula: '+o.cedula+' · Dirección: '+(o.shipping_address||'');
      const phone=document.createElement('td');phone.textContent=o.phone||'—';
      const items=document.createElement('td');items.textContent=o.items||'—';
      const total=document.createElement('td');total.textContent=o.amount||'—';
      const manage=document.createElement('td');manage.className='admin-actions';
      const statusSelect=document.createElement('select');
      ['nuevo','confirmado','preparando','enviado','entregado','cancelado'].forEach(v=>{const op=document.createElement('option');op.value=v;op.textContent=v.replaceAll('_',' ');op.selected=(o.status||'nuevo')===v;statusSelect.append(op)});
      const eta=document.createElement('input');eta.type='text';eta.maxLength=120;eta.placeholder='Ej. 2-3 días';eta.value=o.estimated_delivery||'';eta.setAttribute('aria-label','Entrega estimada del pedido '+o.id);
      const save=document.createElement('button');save.type='button';save.className='btn btn-secondary';save.textContent='Guardar';
      save.addEventListener('click',async()=>{
        save.disabled=true;
        try{
          await api('/rest/v1/orders?id=eq.'+encodeURIComponent(o.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:statusSelect.value,estimated_delivery:eta.value.trim()||null,updated_at:new Date().toISOString()})});
          o.status=statusSelect.value;o.estimated_delivery=eta.value.trim()||null;save.textContent='Guardado ✓';setTimeout(()=>save.textContent='Guardar',1400);
        }catch(err){alert(err.message)}finally{save.disabled=false}
      });
      manage.append(statusSelect,eta,save);
      const actions=document.createElement('td');actions.className='admin-actions';
      const wa=document.createElement('a');wa.className='btn btn-secondary';wa.target='_blank';wa.rel='noopener noreferrer';wa.href=orderWhatsapp(o);wa.textContent='WhatsApp';
      const del=document.createElement('button');del.type='button';del.className='btn btn-secondary';del.textContent='Eliminar';
      del.addEventListener('click',async()=>{if(!confirm('¿Eliminar este pedido?'))return;try{await api('/rest/v1/orders?id=eq.'+encodeURIComponent(o.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});orders=orders.filter(x=>x.id!==o.id);renderOrders()}catch(err){alert(err.message)}});
      actions.append(wa,del);
      tr.append(date,customer,phone,items,total,manage,actions);return tr;
    }));
  }
  $('#admin-search').addEventListener('input', e => {
    productQuery=e.target.value.trim().toLocaleLowerCase('es'); renderProducts(productQuery?products.filter(p=>(p.name+' '+(p.brand||'')).toLocaleLowerCase('es').includes(productQuery)):products);
  });
  function editProduct(p) {
    for (const name of ['id','name','brand','price','size','gender','availability','sort_order','description','image_url']) if (form.elements[name]) form.elements[name].value=p[name]??'';
    form.elements.notes_top.value=(p.notes_top||[]).join(', '); form.elements.notes_heart.value=(p.notes_heart||[]).join(', '); form.elements.notes_base.value=(p.notes_base||[]).join(', ');
    form.elements.gallery_urls.value=(p.gallery_urls||[]).join('\n'); form.elements.active.checked=p.active!==false;
    // Con oferta activa, "Precio" muestra el precio normal y "Precio de oferta" el vigente.
    if(p.original_price){form.elements.price.value=p.original_price;form.elements.offer_price.value=p.price;form.elements.offer_label.value=p.offer_label||'';form.elements.offer_ends.value=toLocalInput(p.offer_ends_at)}
    else{form.elements.offer_price.value='';form.elements.offer_label.value='';form.elements.offer_ends.value=''}
    $('#form-title').textContent='Editar perfume'; $('#cancel-edit').classList.remove('hidden'); form.scrollIntoView({behavior:'smooth'});
  }
  function resetForm() { form.reset(); form.elements.id.value=''; form.elements.active.checked=true; form.elements.sort_order.value=0; $('#form-title').textContent='Agregar perfume'; $('#cancel-edit').classList.add('hidden'); }
  $('#cancel-edit').addEventListener('click', resetForm);
  async function upload(file, prefix) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Cada imagen debe pesar menos de 3 MB.');
    const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase();
    const path=prefix+'/'+Date.now()+'-'+crypto.randomUUID()+'.'+ext;
    const res=await fetch(base+'/storage/v1/object/product-images/'+path,{method:'POST',headers:{...authHeaders(false),'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});
    await parse(res); return base+'/storage/v1/object/public/product-images/'+path;
  }
  form.addEventListener('submit', async e => {
    e.preventDefault(); status(productStatus,'Guardando…');
    try {
      const fd=new FormData(form), id=String(fd.get('id')||'');
      let imageUrl=String(fd.get('image_url')||'').trim();
      const mainFile=form.elements.image_file.files[0]; if(mainFile) imageUrl=await upload(mainFile,'main');
      let gallery=normalizeArray(fd.get('gallery_urls')).slice(0,3);
      const files=[...form.elements.gallery_files.files]; if(files.length>3) throw new Error('Selecciona un máximo de 3 imágenes para la galería.');
      for(const file of files) gallery.push(await upload(file,'gallery'));
      gallery=[...new Set(gallery)].slice(0,3);
      const priceText=normalizePrice(fd.get('price')), rawPrice=priceText?1:NaN;
      const payload={name:String(fd.get('name')).trim(),brand:String(fd.get('brand')||'').trim(),price:priceText,size:String(fd.get('size')||'').trim(),gender:String(fd.get('gender')),availability:String(fd.get('availability')),sort_order:Number(fd.get('sort_order'))||0,image_url:imageUrl||null,notes_top:normalizeArray(fd.get('notes_top')),notes_heart:normalizeArray(fd.get('notes_heart')),notes_base:normalizeArray(fd.get('notes_base')),gallery_urls:gallery,description:String(fd.get('description')||'').trim(),active:fd.get('active')==='on'};
      if(!payload.name||!Number.isFinite(rawPrice)) throw new Error('Completa el nombre y un precio válido.');
      if(offersEnabled()){
        const offerText=normalizePrice(fd.get('offer_price'));
        if(offerText){
          const before=amountsOf(payload.price),now=amountsOf(offerText);
          if(before.length!==now.length||now.some((n,i)=>n>=before[i])) throw new Error('El precio de oferta debe ser menor que el precio normal y tener las mismas presentaciones ('+before.length+').');
          const endsRaw=String(fd.get('offer_ends')||''),ends=endsRaw?new Date(endsRaw):null;
          if(ends&&!(ends>new Date())) throw new Error('La fecha de fin de la oferta debe ser futura.');
          Object.assign(payload,{original_price:payload.price,price:offerText,offer_label:String(fd.get('offer_label')||'').trim()||null,offer_ends_at:ends?ends.toISOString():null});
        } else Object.assign(payload,{original_price:null,offer_label:null,offer_ends_at:null});
      }
      const path=id?'/rest/v1/products?id=eq.'+encodeURIComponent(id):'/rest/v1/products';
      await api(path,{method:id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      status(productStatus,'Producto guardado.','success'); resetForm(); await loadAll();
    } catch(err){status(productStatus,err.message,'error')}
  });
  // --- Carga de fotos por lote: el ID del producto sale del nombre del archivo (0012-nombre.jpg). ---
  const batchForm = $('#batch-form'), batchStatus = $('#batch-status'), batchLog = $('#batch-log'), batchReport = $('#batch-report');
  function batchId(name) { const m = /^(\d{1,9})[-_.]/.exec(String(name)); return m ? Number(m[1]) : null; }
  async function imageSize(file) {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height }; bitmap.close?.(); return size;
  }
  function batchRow(file, product, message, kind) {
    const tr = document.createElement('tr'), cells = [document.createElement('td'), document.createElement('td'), document.createElement('td')];
    cells[0].textContent = file.name; cells[1].textContent = product ? '#' + product.id + ' ' + product.name : '—'; cells[2].textContent = message; cells[2].className = kind || '';
    tr.append(...cells); batchLog.append(tr);
  }
  async function processBatchFile(file, replace) {
    const id = batchId(file.name), product = id ? products.find(p => Number(p.id) === id) : null;
    if (!id) return ['El nombre debe empezar con el ID y un guion.', 'error', null];
    if (!product) return ['No existe un producto con ese ID.', 'error', null];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return ['Formato no permitido (usa JPG, PNG o WebP).', 'error', product];
    if (file.size > MAX_IMAGE_BYTES) return ['Pesa más de 3 MB.', 'error', product];
    if (product.image_url && !replace) return ['Ya tiene foto; se omitió.', 'muted', product];
    let dims; try { dims = await imageSize(file); } catch { return ['La imagen no se puede leer.', 'error', product]; }
    if (dims.width < MIN_IMAGE_SIDE || dims.height < MIN_IMAGE_SIDE) return ['Mide ' + dims.width + '×' + dims.height + '; el mínimo es 500×500.', 'error', product];
    const url = await upload(file, 'products/' + id);
    await api('/rest/v1/products?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ image_url: url }) });
    product.image_url = url;
    return ['Foto actualizada ✓', 'success', product];
  }
  batchForm.addEventListener('submit', async e => {
    e.preventDefault();
    const files = [...$('#batch-files').files], replace = $('#batch-replace').checked, button = batchForm.querySelector('button[type="submit"]');
    if (!files.length) return;
    if (files.length > BATCH_MAX) { status(batchStatus, 'Máximo ' + BATCH_MAX + ' fotos por lote.', 'error'); return; }
    const ids = files.map(f => batchId(f.name)).filter(Boolean);
    if (new Set(ids).size !== ids.length) { status(batchStatus, 'Hay dos archivos con el mismo ID de producto.', 'error'); return; }
    button.disabled = true; batchLog.replaceChildren(); batchReport.classList.remove('hidden');
    let ok = 0, skipped = 0, failed = 0;
    for (const [index, file] of files.entries()) {
      status(batchStatus, 'Procesando ' + (index + 1) + ' de ' + files.length + '…');
      try {
        const [message, kind, product] = await processBatchFile(file, replace);
        batchRow(file, product, message, kind);
        if (kind === 'success') ok++; else if (kind === 'muted') skipped++; else failed++;
      } catch (err) { failed++; batchRow(file, null, err.message, 'error'); }
    }
    button.disabled = false;
    status(batchStatus, 'Lote terminado: ' + ok + ' actualizadas, ' + skipped + ' omitidas, ' + failed + ' con error.', failed ? 'error' : 'success');
    await loadAll();
  });
  $('#order-form').addEventListener('submit', async e => {
    e.preventDefault(); const el=$('#order-status'); status(el,'Guardando…');
    try {
      const fd=new FormData(e.currentTarget);
      const payload={customer_name:String(fd.get('customer_name')).trim(),phone:String(fd.get('phone')).trim(),amount:String(fd.get('amount')||'').trim(),status:String(fd.get('status')),items:String(fd.get('items')).trim(),notes:String(fd.get('notes')||'').trim()};
      await api('/rest/v1/orders',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      e.currentTarget.reset(); status(el,'Pedido guardado.','success'); await loadAll();
    } catch(err){status(el,err.message,'error')}
  });
  async function deleteProduct(p) {
    if(!confirm('¿Eliminar definitivamente “'+p.name+'”?'))return;
    try{await api('/rest/v1/products?id=eq.'+encodeURIComponent(p.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});products=products.filter(x=>x.id!==p.id);renderProducts()}catch(err){alert(err.message)}
  }
  // --- Ofertas por evento (price = precio de oferta; original_price = precio normal) ---
  const offersEnabled = () => products.length > 0 && Object.prototype.hasOwnProperty.call(products[0], 'original_price');
  const amountsOf = v => (String(v || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(x => Number(x.replace(/,/g, '')));
  // Descuento en %, redondeado al múltiplo de 50 más cercano y siempre menor que el precio anterior.
  function discountedAmounts(baseText, percent) {
    const amounts = amountsOf(baseText);
    if (!amounts.length) return null;
    const result = amounts.map(n => { let d = Math.round(n * (1 - percent / 100) / 50) * 50; if (d >= n) d = n - 50; return d; });
    return result.every((d, i) => d >= 50 && d < amounts[i]) ? result : null;
  }
  const discountedText = (baseText, percent) => { const r = discountedAmounts(baseText, percent); return r ? r.map(money).join(' / ') : null; };
  function toLocalInput(iso) {
    if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  const offerForm = $('#offer-form'), offersBody = $('#offers-body'), offerStatus = $('#offer-status');
  const offerSelected = new Set();
  function applyOfferUi() {
    const on = offersEnabled();
    ['#offer-price-label', '#offer-event-label', '#offer-end-label'].forEach(sel => $(sel).classList.toggle('hidden', !on));
    $('#offers-notice').classList.toggle('hidden', on); offerForm.classList.toggle('hidden', !on);
  }
  function offerCandidates() {
    const q = $('#offer-search').value.trim().toLocaleLowerCase('es');
    return products.filter(p => p.active !== false && (!q || (p.name + ' ' + (p.brand || '')).toLocaleLowerCase('es').includes(q))).slice(0, 80);
  }
  function renderOffers() {
    if (!offersEnabled()) return;
    const percent = Number(offerForm.elements.percent.value) || 0;
    offersBody.replaceChildren(...offerCandidates().map(p => {
      const tr = document.createElement('tr'), cells = [0, 1, 2, 3, 4].map(() => document.createElement('td'));
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = offerSelected.has(p.id); check.setAttribute('aria-label', 'Seleccionar ' + p.name);
      check.addEventListener('change', () => { check.checked ? offerSelected.add(p.id) : offerSelected.delete(p.id); });
      cells[0].append(check); cells[1].textContent = p.name + (p.size ? ' · ' + p.size : '');
      const normal = p.original_price || p.price; cells[2].textContent = normal;
      cells[3].textContent = discountedText(normal, percent) || 'No aplica';
      cells[4].textContent = p.original_price ? 'En oferta: ' + p.price + (p.offer_label ? ' · ' + p.offer_label : '') + (p.offer_ends_at ? ' · hasta ' + new Date(p.offer_ends_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '') : '—';
      tr.append(...cells); return tr;
    }));
  }
  $('#offer-search').addEventListener('input', renderOffers);
  offerForm.elements.percent.addEventListener('input', renderOffers);
  $('#offer-select-all').addEventListener('change', e => { offerCandidates().forEach(p => e.target.checked ? offerSelected.add(p.id) : offerSelected.delete(p.id)); renderOffers(); });
  async function patchProducts(items, bodyFor, verb) {
    let ok = 0, failed = 0, lastError = '';
    for (const [index, p] of items.entries()) {
      status(offerStatus, verb + ' ' + (index + 1) + ' de ' + items.length + '…');
      try { await api('/rest/v1/products?id=eq.' + encodeURIComponent(p.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(bodyFor(p)) }); ok++; }
      catch (err) { failed++; lastError = err.message; }
    }
    status(offerStatus, ok + ' actualizados' + (failed ? ', ' + failed + ' con error (' + lastError + ')' : '') + '.', failed ? 'error' : 'success');
    await loadAll();
  }
  offerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(offerForm), percent = Number(fd.get('percent'));
    if (!(percent >= 1 && percent <= 70)) { status(offerStatus, 'El descuento debe estar entre 1 y 70 %.', 'error'); return; }
    const chosen = products.filter(p => offerSelected.has(p.id) && discountedText(p.original_price || p.price, percent));
    if (!chosen.length) { status(offerStatus, 'Selecciona al menos un perfume al que se pueda aplicar la oferta.', 'error'); return; }
    const endsRaw = String(fd.get('ends') || ''), ends = endsRaw ? new Date(endsRaw) : null;
    if (ends && !(ends > new Date())) { status(offerStatus, 'La fecha de fin debe ser futura.', 'error'); return; }
    const label = String(fd.get('label') || '').trim() || null;
    if (!confirm('¿Aplicar ' + percent + ' % de descuento a ' + chosen.length + ' perfume(s)' + (label ? ' por "' + label + '"' : '') + '? Se verá en la tienda de inmediato.')) return;
    await patchProducts(chosen, p => { const base = p.original_price || p.price; return { original_price: base, price: discountedText(base, percent), offer_label: label, offer_ends_at: ends ? ends.toISOString() : null }; }, 'Aplicando');
  });
  const endOffer = p => ({ price: p.original_price, original_price: null, offer_label: null, offer_ends_at: null });
  $('#offer-remove').addEventListener('click', async () => {
    const chosen = products.filter(p => offerSelected.has(p.id) && p.original_price);
    if (!chosen.length) { status(offerStatus, 'Ninguno de los seleccionados tiene oferta activa.', 'error'); return; }
    if (confirm('¿Quitar la oferta a ' + chosen.length + ' perfume(s)? Volverán a su precio normal.')) await patchProducts(chosen, endOffer, 'Quitando');
  });
  $('#offer-remove-all').addEventListener('click', async () => {
    const chosen = products.filter(p => p.original_price);
    if (!chosen.length) { status(offerStatus, 'No hay ofertas activas.', 'error'); return; }
    if (confirm('¿Terminar TODAS las ofertas (' + chosen.length + ' perfumes)? Volverán a su precio normal.')) await patchProducts(chosen, endOffer, 'Terminando');
  });

  // --- Cuentas Clientes (función admin_list_customers de Supabase; solo responde a administradores con MFA) ---
  let customers = [];
  const dateText = v => v ? new Date(v).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  function originText(o) {
    if (!o || typeof o !== 'object') return '—';
    const campaign = o.utm && (o.utm.campaign || o.utm.source) ? 'campaña ' + (o.utm.campaign || o.utm.source) : '';
    return [o.fuente, campaign, o.dispositivo, o.navegador, o.idioma, o.zona].filter(Boolean).join(' · ') || '—';
  }
  function renderCustomers() {
    const q = $('#customers-search').value.trim().toLocaleLowerCase('es');
    const list = customers.filter(c => !q || [c.correo, c.nombre, c.apellidos, c.telefono].join(' ').toLocaleLowerCase('es').includes(q));
    const week = Date.now() - 7 * 86400000;
    $('#customers-summary').textContent = customers.length
      ? customers.length + ' cuentas · ' + customers.filter(c => c.correo_confirmado).length + ' con correo confirmado · ' + customers.filter(c => c.mfa_activo).length + ' con MFA · ' + customers.filter(c => c.pedidos > 0).length + ' con pedidos · ' + customers.filter(c => Date.parse(c.cuenta_creada) > week).length + ' nuevas en 7 días'
      : 'Todavía no hay cuentas de clientes.';
    $('#customers-body').replaceChildren(...list.map(c => {
      const tr = document.createElement('tr');
      const values = [c.correo || '—', [c.nombre, c.apellidos].filter(Boolean).join(' ') || '—', c.telefono || '—', dateText(c.cuenta_creada), dateText(c.ultimo_acceso), c.correo_confirmado ? 'Sí' : 'No', c.mfa_activo ? 'Sí' : 'No', String(c.pedidos ?? 0), originText(c.origen)];
      values.forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); return tr;
    }));
  }
  async function loadCustomers() {
    const notice = $('#customers-notice');
    try { customers = await api('/rest/v1/rpc/admin_list_customers', { method: 'POST', body: '{}' }); notice.classList.add('hidden'); }
    catch (err) {
      customers = []; notice.classList.remove('hidden');
      notice.textContent = /admin_list_customers|schema cache|could not find/i.test(err.message) ? 'Para ver las cuentas falta aplicar la migración "cuentas_clientes" en Supabase (SQL Editor).' : 'No se pudieron cargar las cuentas: ' + err.message;
    }
    renderCustomers();
  }
  $('#customers-search').addEventListener('input', renderCustomers);
  $('#customers-refresh').addEventListener('click', loadCustomers);

  if(!base||!key){status(loginStatus,'Falta la configuración de Supabase.','error')}else restore();
})();