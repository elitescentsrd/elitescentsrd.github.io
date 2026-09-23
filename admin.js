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
    loadCustomers(); loadCoupons(); loadStoreSettings();
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
    const text='Hola '+(o.customer_name||'')+', recibimos tu pedido #'+o.id+' en Elite Scents RD.'+eta+'\n\n'+(o.items||'')+'\n\nTotal: '+(o.amount||'Por confirmar')+(o.coupon_code?' (con el cupón '+o.coupon_code+')':'');
    // wa.me exige el código de país: un número dominicano de 10 dígitos (809/829/849) lleva 1 delante.
    let digits=String(o.phone||'').replace(/\D/g,'');if(digits.length===10)digits='1'+digits;
    return 'https://wa.me/'+digits+'?text='+encodeURIComponent(text);
  }
  function renderOrders() {
    updatePending(); renderSales();
    ordersBody.replaceChildren(...orders.map(o => {
      const tr=document.createElement('tr');
      const date=document.createElement('td');date.textContent=new Date(o.created_at).toLocaleString('es-DO');
      const customer=document.createElement('td');customer.textContent=o.customer_name||'—';
      if(o.cedula) customer.title='Cédula: '+o.cedula+' · Dirección: '+(o.shipping_address||'');
      const phone=document.createElement('td');phone.textContent=o.phone||'—';
      const items=document.createElement('td');items.textContent=o.items||'—';
      const total=document.createElement('td');total.textContent=o.amount||'—';
      if(o.coupon_code){const note=document.createElement('small');note.textContent='Cupón '+o.coupon_code+' (−'+money(o.discount_amount)+')';total.append(document.createElement('br'),note)}
      const manage=document.createElement('td');manage.className='admin-actions';
      const statusSelect=document.createElement('select');
      ['nuevo','confirmado','preparando','enviado','entregado','cancelado'].forEach(v=>{const op=document.createElement('option');op.value=v;op.textContent=v.replaceAll('_',' ');op.selected=(o.status||'nuevo')===v;statusSelect.append(op)});
      const eta=document.createElement('input');eta.type='text';eta.maxLength=120;eta.placeholder='Ej. 2-3 días';eta.value=o.estimated_delivery||'';eta.setAttribute('aria-label','Entrega estimada del pedido '+o.id);
      const save=document.createElement('button');save.type='button';save.className='btn btn-secondary';save.textContent='Guardar';
      save.addEventListener('click',async()=>{
        save.disabled=true;
        try{
          await api('/rest/v1/orders?id=eq.'+encodeURIComponent(o.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:statusSelect.value,estimated_delivery:eta.value.trim()||null,updated_at:new Date().toISOString()})});
          o.status=statusSelect.value;o.estimated_delivery=eta.value.trim()||null;renderSales();save.textContent='Guardado ✓';setTimeout(()=>save.textContent='Guardar',1400);
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
    e.preventDefault(); const el=$('#order-status'), orderForm=e.currentTarget; status(el,'Guardando…');
    try {
      const fd=new FormData(orderForm);
      const payload={customer_name:String(fd.get('customer_name')).trim(),phone:String(fd.get('phone')).trim(),amount:String(fd.get('amount')||'').trim(),status:String(fd.get('status')),items:String(fd.get('items')).trim(),notes:String(fd.get('notes')||'').trim()};
      await api('/rest/v1/orders',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      orderForm.reset(); status(el,'Pedido guardado.','success'); await loadAll();
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
    if (on) fillOfferBrands();
    ['#offer-price-label', '#offer-event-label', '#offer-end-label'].forEach(sel => $(sel).classList.toggle('hidden', !on));
    $('#offers-notice').classList.toggle('hidden', on); offerForm.classList.toggle('hidden', !on);
  }
  // Filtros iguales a los del catálogo: búsqueda, precio, marca, género y estado; se recorren los 420 perfumes.
  const offerFilter = { q: '', price: 'all', brand: 'all', gender: 'todos', state: 'all' };
  const OFFER_PAGE = 50; let offerVisible = OFFER_PAGE;
  function offerPriceMatches(p, value) {
    const values = amountsOf(p.original_price || p.price), n = values.length ? Math.max(...values) : 0;
    if (value === 'under3000') return n < 3000;
    if (value === '3000-4999') return n >= 3000 && n < 5000;
    if (value === '5000-6999') return n >= 5000 && n < 7000;
    if (value === '7000plus') return n >= 7000;
    return true;
  }
  function offerCandidates() {
    const q = offerFilter.q.toLocaleLowerCase('es');
    return products.filter(p => p.active !== false
      && (!q || (p.name + ' ' + (p.brand || '') + ' ' + (p.size || '')).toLocaleLowerCase('es').includes(q))
      && offerPriceMatches(p, offerFilter.price)
      && (offerFilter.brand === 'all' || p.brand === offerFilter.brand)
      && (offerFilter.gender === 'todos' || p.gender === offerFilter.gender)
      && (offerFilter.state === 'all' || (offerFilter.state === 'offer' ? Boolean(p.original_price) : !p.original_price)));
  }
  function fillOfferBrands() {
    const select = $('#offer-brand'), current = offerFilter.brand;
    const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    select.replaceChildren(new Option('Todas las marcas', 'all'), ...brands.map(b => new Option(b, b)));
    select.value = brands.includes(current) ? current : 'all'; offerFilter.brand = select.value;
  }
  function updateOfferCounters(list = offerCandidates()) {
    $('#offer-select-all').checked = list.length > 0 && list.every(p => offerSelected.has(p.id));
    $('#offer-select-label').textContent = 'Seleccionar los ' + list.length + ' perfumes de esta búsqueda';
    $('#offer-selected-count').textContent = offerSelected.size ? offerSelected.size + ' seleccionado(s) en total' : 'Ninguno seleccionado';
  }
  function renderOffers() {
    if (!offersEnabled()) return;
    const percent = Number(offerForm.elements.percent.value) || 0, list = offerCandidates(), shown = list.slice(0, offerVisible);
    const total = products.filter(p => p.active !== false).length;
    $('#offer-count').textContent = list.length ? 'Mostrando ' + shown.length + ' de ' + list.length + ' perfumes' + (list.length < total ? ' (de ' + total + ' en total)' : '') : 'No hay perfumes con esos filtros.';
    const more = $('#offer-more'); more.classList.toggle('hidden', list.length <= shown.length); more.textContent = 'Mostrar ' + Math.min(OFFER_PAGE, list.length - shown.length) + ' más (faltan ' + (list.length - shown.length) + ')';
    updateOfferCounters(list);
    offersBody.replaceChildren(...shown.map(p => {
      const tr = document.createElement('tr'), cells = [0, 1, 2, 3, 4].map(() => document.createElement('td'));
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = offerSelected.has(p.id); check.setAttribute('aria-label', 'Seleccionar ' + p.name);
      check.addEventListener('change', () => { check.checked ? offerSelected.add(p.id) : offerSelected.delete(p.id); updateOfferCounters(); });
      cells[0].append(check); cells[1].textContent = p.name + (p.size ? ' · ' + p.size : '');
      const normal = p.original_price || p.price; cells[2].textContent = normal;
      cells[3].textContent = discountedText(normal, percent) || 'No aplica';
      cells[4].textContent = p.original_price ? 'En oferta: ' + p.price + (p.offer_label ? ' · ' + p.offer_label : '') + (p.offer_ends_at ? ' · hasta ' + new Date(p.offer_ends_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '') : '—';
      tr.append(...cells); return tr;
    }));
  }
  const refreshOffers = () => { offerVisible = OFFER_PAGE; renderOffers(); };
  $('#offer-search').addEventListener('input', e => { offerFilter.q = e.target.value.trim(); refreshOffers(); });
  $('#offer-price').addEventListener('change', e => { offerFilter.price = e.target.value; refreshOffers(); });
  $('#offer-brand').addEventListener('change', e => { offerFilter.brand = e.target.value; refreshOffers(); });
  $('#offer-state').addEventListener('change', e => { offerFilter.state = e.target.value; refreshOffers(); });
  document.querySelectorAll('[data-offer-gender]').forEach(button => button.addEventListener('click', () => {
    offerFilter.gender = button.dataset.offerGender;
    document.querySelectorAll('[data-offer-gender]').forEach(other => other.classList.toggle('active', other === button)); refreshOffers();
  }));
  $('#offer-clear').addEventListener('click', () => {
    Object.assign(offerFilter, { q: '', price: 'all', brand: 'all', gender: 'todos', state: 'all' });
    $('#offer-search').value = ''; $('#offer-price').value = 'all'; $('#offer-brand').value = 'all'; $('#offer-state').value = 'all';
    document.querySelectorAll('[data-offer-gender]').forEach(other => other.classList.toggle('active', other.dataset.offerGender === 'todos')); refreshOffers();
  });
  $('#offer-more').addEventListener('click', () => { offerVisible += OFFER_PAGE; renderOffers(); });
  $('#offer-deselect').addEventListener('click', () => { offerSelected.clear(); renderOffers(); });
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
    renderCustomers(); renderSales();
  }
  $('#customers-search').addEventListener('input', renderCustomers);
  $('#customers-refresh').addEventListener('click', loadCustomers);

  // --- Resumen de ventas (los cálculos viven en sales.js) ---
  let salesMetric = 'orders';
  const rd = n => 'RD$' + new Intl.NumberFormat('es-DO').format(Math.round(n));
  function kpi(label, value, note, tone) {
    const box = document.createElement('div'); box.className = 'kpi' + (tone ? ' ' + tone : '');
    const small = document.createElement('small'); small.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    box.append(small, strong);
    if (note) { const em = document.createElement('em'); em.textContent = note; box.append(em); }
    return box;
  }
  function versus(now, before) { const c = window.EliteSales.change(now, before); return c === null ? '' : (c > 0 ? '+' : '') + c + '% frente al período anterior'; }
  function emptyRow(cols, text) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = cols; td.className = 'muted'; td.textContent = text; tr.append(td); return tr; }
  function salesChart(days) {
    const NS = 'http://www.w3.org/2000/svg', W = 720, H = 150, svg = document.createElementNS(NS, 'svg');
    const values = days.map(d => d[salesMetric]), max = Math.max(1, ...values), bw = W / Math.max(days.length, 1);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 22)); svg.setAttribute('class', 'sales-svg'); svg.setAttribute('aria-hidden', 'true');
    const base = document.createElementNS(NS, 'line'); [['x1', 0], ['x2', W], ['y1', H], ['y2', H], ['stroke', '#d9d4c9']].forEach(([k, v]) => base.setAttribute(k, v)); svg.append(base);
    days.forEach((d, i) => {
      const value = values[i], h = value ? Math.max(3, (value / max) * H) : 0, bar = document.createElementNS(NS, 'rect');
      [['x', i * bw + 1], ['y', H - h], ['width', Math.max(bw - 2, 1)], ['height', h], ['fill', '#bd9b5d']].forEach(([k, v]) => bar.setAttribute(k, v));
      const tip = document.createElementNS(NS, 'title'); tip.textContent = d.label + ': ' + d.orders + ' pedido(s) · ' + rd(d.sales) + ' en ventas confirmadas'; bar.append(tip); svg.append(bar);
    });
    const step = Math.max(1, Math.ceil(days.length / 7));
    days.forEach((d, i) => { if (i % step) return; const t = document.createElementNS(NS, 'text'); [['x', i * bw], ['y', H + 16], ['font-size', 11], ['fill', '#6f6a5f']].forEach(([k, v]) => t.setAttribute(k, v)); t.textContent = d.label; svg.append(t); });
    return svg;
  }
  function renderSales() {
    const Sales = window.EliteSales; if (!Sales || !$('#sales-kpis')) return;
    try {
      const s = Sales.summarize(orders, customers, { period: $('#sales-period').value }), t = s.totals, p = s.previous;
      $('#sales-kpis').replaceChildren(
        kpi('Pedidos recibidos', String(t.received), p ? versus(t.received, p.received) : ''),
        kpi('Ventas confirmadas', rd(t.sales), (p ? versus(t.sales, p.sales) : '') || t.soldCount + ' pedido(s) confirmado(s)'),
        kpi('Ticket promedio', t.soldCount ? rd(t.average) : '—', 'por pedido confirmado'),
        kpi('Por confirmar', rd(t.pendingAmount), t.pendingCount + ' pedido(s) nuevo(s)', t.pendingCount ? 'warn' : ''),
        kpi('Cancelados', String(t.cancelled), ''));
      const title = salesMetric === 'orders' ? 'Pedidos por día' : 'Ventas confirmadas por día (RD$)';
      $('#sales-chart-title').textContent = title; $('#sales-chart').setAttribute('aria-label', 'Gráfico: ' + title.toLowerCase());
      $('#sales-chart').replaceChildren(salesChart(s.days));
      document.querySelectorAll('[data-sales-metric]').forEach(b => b.classList.toggle('active', b.dataset.salesMetric === salesMetric));
      $('#sales-top').replaceChildren(...(s.top.length ? s.top.map(x => { const tr = document.createElement('tr'); [x.name, x.units, x.orders].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); return tr; }) : [emptyRow(3, 'Todavía no hay pedidos en este período.')]));
      $('#sales-origins').replaceChildren(...(s.origins.length ? s.origins.map(x => { const tr = document.createElement('tr'); [x.name, x.accounts, x.buyers, x.orders].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); return tr; }) : [emptyRow(4, 'Todavía no hay cuentas de clientes.')]));
    } catch (err) { $('#sales-kpis').textContent = 'No se pudo calcular el resumen: ' + err.message; }
  }
  // --- Cupones de descuento (tablas coupons y coupon_redemptions; solo administradores con verificación en dos pasos) ---
  let coupons = [], couponUse = new Map();
  function couponState(c) {
    const now = Date.now();
    if (!c.active) return 'Inactivo';
    if (c.ends_at && now >= Date.parse(c.ends_at)) return 'Vencido';
    if (c.starts_at && now < Date.parse(c.starts_at)) return 'Programado';
    if (c.max_uses && c.used_count >= c.max_uses) return 'Agotado';
    return 'Activo';
  }
  const couponDiscountText = c => (c.kind === 'percent' ? Number(c.value) + '%' : money(c.value)) + (c.max_discount ? ' (tope ' + money(c.max_discount) + ')' : '');
  function couponRules(c) {
    const rules = [];
    if (Number(c.min_subtotal) > 0) rules.push('compra mínima ' + money(c.min_subtotal));
    rules.push(c.one_per_customer ? '1 uso por cliente' : 'varios usos por cliente');
    if (c.first_order_only) rules.push('solo primera compra');
    rules.push(c.allow_with_offers ? 'con perfumes en oferta' : 'sin perfumes en oferta');
    return rules.join(' · ');
  }
  function couponMessage(c) {
    const what = c.kind === 'percent' ? Number(c.value) + '% de descuento' : money(c.value) + ' de descuento';
    return 'Usa el código ' + c.code + ' en tu carrito y obtén ' + what + (c.description ? ' (' + c.description + ')' : '') + ' en Elite Scents RD: https://elitescentsrd.github.io' + (c.ends_at ? '. Válido hasta el ' + dateText(c.ends_at) : '') + '.';
  }
  // Elimina uno o varios cupones. Si el cupón ya se usó y falta aplicar la actualización "cupones_eliminar", la base lo rechaza.
  async function deleteCoupons(codes) {
    try { await api('/rest/v1/coupons?code=in.(' + codes.map(encodeURIComponent).join(',') + ')', { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); await loadCoupons(); }
    catch (err) { alert(/foreign key|violates|23503/i.test(err.message) ? 'Para eliminar cupones que ya se usaron falta aplicar la actualización "cupones_eliminar" en Supabase (SQL Editor).' : err.message); }
  }
  $('#coupons-clean').addEventListener('click', async () => {
    const old = coupons.filter(c => ['Vencido', 'Agotado', 'Inactivo'].includes(couponState(c)));
    if (!old.length) { alert('No hay cupones vencidos, agotados ni desactivados para limpiar.'); return; }
    const used = old.filter(c => Number(c.used_count) > 0).length, names = old.slice(0, 8).map(c => c.code).join(', ') + (old.length > 8 ? '…' : '');
    if (!confirm('Se eliminarán ' + old.length + ' cupón(es) vencidos, agotados o desactivados: ' + names + '.' + (used ? '\n\n' + used + ' ya se usaron: también se borra su historial de usos (los pedidos conservan el cupón y el descuento).' : '') + '\n\n¿Continuar?')) return;
    await deleteCoupons(old.map(c => c.code));
  });
  function renderCoupons() {
    $('#coupons-body').replaceChildren(...(coupons.length ? coupons.map(c => {
      const tr = document.createElement('tr'), state = couponState(c), use = couponUse.get(c.code) || { count: 0, total: 0 };
      const name = document.createElement('td'), strong = document.createElement('strong'); strong.textContent = c.code; name.append(strong);
      if (c.description) { const small = document.createElement('small'); small.textContent = c.description; name.append(document.createElement('br'), small); }
      const cells = [couponDiscountText(c), couponRules(c), (c.starts_at ? 'desde ' + dateText(c.starts_at) : 'ya vigente') + (c.ends_at ? ' hasta ' + dateText(c.ends_at) : ', sin fecha de fin'),
        c.used_count + (c.max_uses ? ' de ' + c.max_uses : '') + ' (' + money(use.total) + ' descontados)', state].map(text => { const td = document.createElement('td'); td.textContent = text; return td; });
      const actions = document.createElement('td'); actions.className = 'admin-actions';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn btn-secondary'; toggle.textContent = c.active ? 'Desactivar' : 'Activar';
      toggle.addEventListener('click', async () => { try { await api('/rest/v1/coupons?code=eq.' + encodeURIComponent(c.code), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: !c.active }) }); await loadCoupons(); } catch (err) { alert(err.message); } });
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-secondary'; copy.textContent = 'Copiar mensaje';
      copy.addEventListener('click', async () => { const text = couponMessage(c); try { await navigator.clipboard.writeText(text); copy.textContent = 'Copiado ✓'; setTimeout(() => { copy.textContent = 'Copiar mensaje'; }, 1500); } catch { prompt('Copia este mensaje:', text); } });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-secondary'; del.textContent = 'Eliminar';
      del.addEventListener('click', async () => {
        const uses = Math.max(use.count, Number(c.used_count) || 0);
        if (!confirm(uses ? 'El cupón ' + c.code + ' se usó ' + uses + (uses === 1 ? ' vez' : ' veces') + '. Al eliminarlo también se borra su historial de usos; los pedidos conservan el cupón y el descuento que se aplicó.\n\n¿Eliminarlo de todos modos?' : '¿Eliminar el cupón ' + c.code + '?')) return;
        await deleteCoupons([c.code]);
      });
      actions.append(toggle, copy, del); tr.append(name, ...cells, actions); return tr;
    }) : [emptyRow(7, 'Todavía no hay cupones.')]));
  }
  async function loadCoupons() {
    const notice = $('#coupons-notice'), form = $('#coupon-form');
    try {
      coupons = await api('/rest/v1/coupons?select=*&order=created_at.desc');
      const uses = await api('/rest/v1/coupon_redemptions?select=coupon_code,discount&limit=5000').catch(() => []);
      couponUse = new Map(); for (const u of uses) { const e = couponUse.get(u.coupon_code) || { count: 0, total: 0 }; e.count += 1; e.total += Number(u.discount) || 0; couponUse.set(u.coupon_code, e); }
      notice.classList.add('hidden'); form.classList.remove('hidden');
    } catch (err) {
      coupons = []; notice.classList.remove('hidden'); form.classList.add('hidden');
      notice.textContent = /coupons|schema cache|could not find|relation/i.test(err.message) ? 'Para usar cupones falta aplicar la migración "cupones" en Supabase (SQL Editor).' : 'No se pudieron cargar los cupones: ' + err.message;
    }
    renderCoupons();
  }
  $('#coupon-form').addEventListener('submit', async e => {
    e.preventDefault(); const couponForm = e.currentTarget, f = couponForm.elements, st = $('#coupon-status');
    const code = f.code.value.trim().toUpperCase().replace(/\s+/g, ''), kind = f.kind.value, value = Number(f.value.value);
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) { status(st, 'El código debe tener de 3 a 24 letras, números, guion o guion bajo, sin espacios.', 'error'); return; }
    if (!(value > 0)) { status(st, 'Escribe el valor del descuento.', 'error'); return; }
    if (kind === 'percent' && value > 90) { status(st, 'El porcentaje máximo permitido es 90%.', 'error'); return; }
    const starts = f.starts_at.value ? new Date(f.starts_at.value) : null, ends = f.ends_at.value ? new Date(f.ends_at.value) : null;
    if (starts && ends && ends <= starts) { status(st, 'La fecha de fin debe ser posterior a la de inicio.', 'error'); return; }
    const body = { code, kind, value, description: f.description.value.trim(), min_subtotal: Number(f.min_subtotal.value) || 0,
      max_discount: f.max_discount.value ? Number(f.max_discount.value) : null, max_uses: f.max_uses.value ? Number(f.max_uses.value) : null,
      starts_at: starts ? starts.toISOString() : null, ends_at: ends ? ends.toISOString() : null,
      one_per_customer: f.one_per_customer.checked, first_order_only: f.first_order_only.checked, allow_with_offers: f.allow_with_offers.checked, active: true };
    status(st, 'Creando…');
    try { await api('/rest/v1/coupons', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) }); couponForm.reset(); status(st, 'Cupón ' + code + ' creado.', 'ok'); await loadCoupons(); }
    catch (err) { status(st, /duplicate|already exists|23505/i.test(err.message) ? 'Ya existe un cupón con ese código.' : err.message, 'error'); }
  });
  $('#coupons-refresh').addEventListener('click', loadCoupons);

  // --- Seguridad: pausar los pedidos por la web (tabla store_settings) y descargar un respaldo ---
  let ordersPaused = null;
  function renderOrdersState() {
    const label = $('#orders-state'), button = $('#orders-pause');
    label.classList.toggle('danger-text', ordersPaused === true);
    if (ordersPaused === null) { label.textContent = 'Pedidos por la web: estado no disponible'; button.disabled = true; return; }
    label.textContent = ordersPaused ? 'Pedidos por la web: PAUSADOS' : 'Pedidos por la web: activos';
    button.textContent = ordersPaused ? 'Reanudar pedidos por la web' : 'Pausar pedidos por la web';
    button.classList.toggle('btn-secondary', ordersPaused); button.disabled = false;
  }
  async function loadStoreSettings() {
    const notice = $('#security-notice');
    try {
      const rows = await api('/rest/v1/store_settings?select=orders_paused&id=eq.true');
      ordersPaused = Array.isArray(rows) && rows.length ? Boolean(rows[0].orders_paused) : null;
      notice.classList.toggle('hidden', ordersPaused !== null);
      if (ordersPaused === null) notice.textContent = 'No se encontró el ajuste de la tienda: vuelve a ejecutar la migración "protección de pedidos" en Supabase (SQL Editor).';
    } catch (err) {
      ordersPaused = null; notice.classList.remove('hidden');
      notice.textContent = /store_settings|schema cache|could not find|relation/i.test(err.message) ? 'Para usar la pausa falta aplicar la migración "protección de pedidos" en Supabase (SQL Editor).' : 'No se pudo leer el estado de los pedidos: ' + err.message;
    }
    renderOrdersState();
  }
  $('#orders-pause').addEventListener('click', async () => {
    if (ordersPaused === null) return;
    const next = !ordersPaused;
    if (next && !confirm('¿Pausar los pedidos por la web? Nadie podrá pedir desde la tienda hasta que los reanudes. WhatsApp sigue funcionando.')) return;
    $('#orders-pause').disabled = true;
    try { await api('/rest/v1/store_settings?id=eq.true', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ orders_paused: next, updated_at: new Date().toISOString() }) }); }
    catch (err) { alert(err.message); }
    await loadStoreSettings();
  });
  // Lee una tabla completa en páginas de 1,000 filas (el máximo que entrega Supabase por consulta).
  async function fetchAll(path) {
    const rows = [], size = 1000;
    for (let offset = 0; ; offset += size) {
      const page = await api(path + (path.includes('?') ? '&' : '?') + 'limit=' + size + '&offset=' + offset);
      if (!Array.isArray(page)) break;
      rows.push(...page);
      if (page.length < size) break;
    }
    return rows;
  }
  const BACKUP_SOURCES = [
    ['productos', '/rest/v1/products?select=*&order=id.asc'], ['pedidos', '/rest/v1/orders?select=*&order=id.asc'],
    ['cuentas_clientes', '/rest/v1/rpc/admin_list_customers?order=cuenta_creada.asc'], ['perfiles_clientes', '/rest/v1/customer_profiles?select=*'],
    ['cupones', '/rest/v1/coupons?select=*&order=code.asc'], ['usos_de_cupones', '/rest/v1/coupon_redemptions?select=*&order=id.asc'],
    ['ajustes_tienda', '/rest/v1/store_settings?select=*'],
  ];
  $('#backup-download').addEventListener('click', async () => {
    const st = $('#backup-status'), button = $('#backup-download');
    button.disabled = true; status(st, 'Preparando respaldo…');
    const backup = { tienda: 'Elite Scents RD', creado: new Date().toISOString(), aviso: 'Contiene datos personales de clientes. Guárdalo en un lugar privado y no lo compartas.', tablas: {}, sin_acceso: [] };
    try {
      for (const [name, path] of BACKUP_SOURCES) {
        try { backup.tablas[name] = await fetchAll(path); } catch (err) { backup.sin_acceso.push(name + ': ' + err.message); }
      }
      if (!backup.tablas.productos?.length) throw new Error('No se pudieron leer los productos; no se descargó nada.');
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'respaldo-elite-scents-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      const counts = Object.entries(backup.tablas).map(([name, rows]) => rows.length + ' ' + name.replace(/_/g, ' ')).join(', ');
      status(st, 'Respaldo descargado: ' + counts + '.' + (backup.sin_acceso.length ? ' No se pudo leer: ' + backup.sin_acceso.map(s => s.split(':')[0].replace(/_/g, ' ')).join(', ') + '.' : ''), 'success');
    } catch (err) { status(st, err.message, 'error'); }
    finally { button.disabled = false; }
  });

  $('#sales-period').addEventListener('change', renderSales);
  document.querySelectorAll('[data-sales-metric]').forEach(b => b.addEventListener('click', () => { salesMetric = b.dataset.salesMetric; renderSales(); }));

  if(!base||!key){status(loginStatus,'Falta la configuración de Supabase.','error')}else restore();
})();