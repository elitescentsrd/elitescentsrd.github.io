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
    loadAll().then(()=>{knownOrderIds=new Set(orders.map(o=>String(o.id)));loadFinanzas();loadStats();});
    loadCustomers(); loadCoupons(); loadStoreSettings(); loadSurvey();
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
      await loadOrderData(); fillOrderPicker();
      renderProducts(productQuery?products.filter(p=>(p.name+' '+(p.brand||'')).toLocaleLowerCase('es').includes(productQuery)):products);
      applyOfferUi(); renderOffers(); renderFinanzas();
    } catch (err) { status(productStatus, err.message, 'error'); }
  }
  function renderProducts(list = products) {
    productsBody.replaceChildren(...list.slice(0,6).map(p => {
      const tr = document.createElement('tr');
      const img = document.createElement('img'); img.src = p.image_url || '/logo-oficial.webp'; img.alt = '';
      const cells = [document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td')];
      cells[0].append(img); cells[1].textContent = p.name; cells[2].textContent = p.brand || '—'; cells[3].textContent = p.original_price ? p.price + ' (antes ' + p.original_price + ')' : (p.price || '—');
      cells[4].textContent = (p.active === false ? 'Oculto' : (p.availability || 'disponible')) + (stockRows.has(Number(p.id)) ? ' · en casa: ' + stockLabel(p.id) : '');
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
      if(paymentsReady&&F&&F.SOLD.includes(String(o.status||'nuevo'))){const b=F.balances([o],payments).rows[0];if(b&&b.total){const note=document.createElement('small');note.className='order-balance'+(b.due>0?' due':'');note.textContent=b.due>0?'Abonado '+rd(b.paid)+' · Falta '+rd(b.due):'Pagado ✓';total.append(note)}}
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
    // La cantidad solo se guarda si la cambias aquí (si mientras tanto se confirmó un pedido, no se pisa lo que descontó).
    form.elements.stock.value=form.elements.stock.dataset.loaded=stockLabel(p.id);
    form.elements.inspired_by.value=p.inspired_by||''; {const cr=costRows.get(Number(p.id)); form.elements.cost.value=cr?cr.costs.map(Number).map(c=>c.toLocaleString('en-US')).join(' / '):''; form.elements.strategy.value=cr?.strategy||'normal';} updateSuggestion();
    // Con oferta activa, "Precio" muestra el precio normal y "Precio de oferta" el vigente.
    if(p.original_price){form.elements.price.value=p.original_price;form.elements.offer_price.value=p.price;form.elements.offer_label.value=p.offer_label||'';form.elements.offer_ends.value=toLocalInput(p.offer_ends_at)}
    else{form.elements.offer_price.value='';form.elements.offer_label.value='';form.elements.offer_ends.value=''}
    $('#form-title').textContent='Editar perfume'; $('#cancel-edit').classList.remove('hidden'); form.scrollIntoView({behavior:'smooth'});
  }
  function resetForm() { form.reset(); form.elements.stock.dataset.loaded=''; form.elements.id.value=''; form.elements.active.checked=true; form.elements.sort_order.value=0; $('#form-title').textContent='Agregar perfume'; $('#cancel-edit').classList.add('hidden'); updateSuggestion(); }
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
      const stockRaw=String(fd.get('stock')||'').trim(), stockPlan=stockReady===true&&stockRaw!==(form.elements.stock.dataset.loaded||'')?parseStock(stockRaw,payload.size):undefined;
      if(hasInspired()){const insp=String(fd.get('inspired_by')||'').trim();if(insp.length===1)throw new Error('«Inspirado en» debe tener al menos 2 letras (o déjalo vacío).');payload.inspired_by=insp||null;}
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
      const saved=await api(path,{method:id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      const savedId=id||(Array.isArray(saved)&&saved[0]?saved[0].id:null), costNote=await saveProductCost(savedId);
      let stockNote='';if(stockPlan!==undefined&&savedId){try{stockNote=await saveStock(savedId,stockPlan)}catch(err){stockNote='(La cantidad en casa no se guardó: '+err.message+')'}}
      status(productStatus,'Producto guardado.'+costNote+(stockNote?' '+stockNote:''),'success'); resetForm(); await loadAll();
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


  // --- Estadísticas de la tienda (visitas, búsquedas, perfumes vistos): resumen de la base de datos, solo administradores ---
  async function loadStats() {
    const notice = $('#stats-notice'); if (!notice) return;
    try {
      const data = await api('/rest/v1/rpc/admin_site_stats', { method: 'POST', body: JSON.stringify({ p_days: Number($('#stats-period').value) || 30 }) });
      notice.classList.add('hidden'); renderStats(data || {});
    } catch (err) {
      notice.classList.remove('hidden');
      notice.textContent = /could not find|does not exist|PGRST20[2-5]|schema cache/i.test(String(err.message)) ? 'Para ver estadísticas falta aplicar el script «Estadísticas y publicación automática» en Supabase (SQL Editor).' : 'No se pudieron cargar las estadísticas: ' + err.message;
      renderStats({});
    }
  }
  function statsRows(target, rows, cols, map, empty) { $(target).replaceChildren(...(rows && rows.length ? rows.map(r => { const tr = document.createElement('tr'); map(r).forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); return tr; }) : [emptyRow(cols, empty)])); }
  function renderStats(d) {
    const t = d.totales || {}, n = v => new Intl.NumberFormat('es-DO').format(Number(v) || 0);
    $('#stats-kpis').replaceChildren(
      kpi('Visitas', n(t.visitas), d.dias ? 'en ' + d.dias + ' días' : ''),
      kpi('Perfumes vistos', n(t.perfumes), ''),
      kpi('Búsquedas', n(t.busquedas), t.sin_resultado ? n(t.sin_resultado) + ' sin resultado' : '', t.sin_resultado ? 'warn' : ''),
      kpi('Clics a WhatsApp', n(t.whatsapp), t.carrito ? n(t.carrito) + ' al carrito' : ''));
    const days = (d.por_dia || []).map(x => ({ label: String(x.dia).slice(5), orders: Number(x.visitas) || 0 }));
    const chart = $('#stats-chart'); chart.replaceChildren();
    if (days.length) {
      const NS = 'http://www.w3.org/2000/svg', W = 720, H = 120, svg = document.createElementNS(NS, 'svg'), max = Math.max(1, ...days.map(x => x.orders)), bw = W / days.length;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 18)); svg.setAttribute('class', 'sales-svg'); svg.setAttribute('aria-hidden', 'true');
      days.forEach((x, i) => { const h = Math.round(x.orders / max * H), r = document.createElementNS(NS, 'rect'); [['x', i * bw + 1], ['y', H - h], ['width', Math.max(1, bw - 2)], ['height', h], ['fill', '#8a682d']].forEach(([k, v]) => r.setAttribute(k, v)); const title = document.createElementNS(NS, 'title'); title.textContent = x.label + ': ' + x.orders + ' visitas'; r.append(title); svg.append(r); });
      chart.append(svg);
    } else chart.textContent = 'Todavía no hay visitas contadas en este período.';
    statsRows('#stats-missing', d.sin_resultado, 2, r => [r.texto, n(r.veces)], 'Nadie se quedó sin encontrar lo que buscaba.');
    statsRows('#stats-searches', d.busquedas, 3, r => [r.texto, n(r.veces), n(r.sin_resultado)], 'Sin búsquedas en este período.');
    statsRows('#stats-products', d.perfumes, 4, r => [r.nombre, n(r.vistas), n(r.whatsapp), n(r.carrito)], 'Sin perfumes vistos en este período.');
    statsRows('#stats-sources', d.origenes, 2, r => [r.origen, n(r.visitas)], 'Sin visitas en este período.');
    const dev = d.dispositivos || []; $('#stats-devices').textContent = dev.length ? 'Desde: ' + dev.map(x => ({ movil: 'celular', computadora: 'computadora' }[x.dispositivo] || x.dispositivo) + ' ' + n(x.visitas)).join(' · ') : '';
  }
  $('#stats-period')?.addEventListener('change', loadStats);

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
      const s = Sales.summarize(orders, customers, { period: $('#sales-period').value, lines: orderLines, products }), t = s.totals, p = s.previous;
      $('#sales-kpis').replaceChildren(
        kpi('Pedidos recibidos', String(t.received), p ? versus(t.received, p.received) : ''),
        kpi('Ventas confirmadas', rd(t.sales), (p ? versus(t.sales, p.sales) : '') || t.soldCount + ' pedido(s) confirmado(s)'),
        kpi('Ticket promedio', t.soldCount ? rd(t.average) : '—', 'por pedido confirmado'),
        kpi('Por confirmar', rd(t.pendingAmount), t.pendingCount + ' pedido(s) nuevo(s)', t.pendingCount ? 'warn' : ''),
        kpi('Cancelados', String(t.cancelled), ''), ...financeKpis(s.range));
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
      // Los cupones personales de la encuesta (uno por cliente) se ven en la sección Encuesta, no en esta lista.
      coupons = await api('/rest/v1/coupons?select=*&source=is.null&order=created_at.desc')
        .catch(err => { if (/source/i.test(err.message)) return api('/rest/v1/coupons?select=*&order=created_at.desc'); throw err; });
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
    if (/^ES-/.test(code)) { status(st, 'Los códigos que empiezan con ES- están reservados para los cupones de la encuesta. Elige otro.', 'error'); return; }
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
    ['ajustes_tienda', '/rest/v1/store_settings?select=*'], ['encuesta_respuestas', '/rest/v1/survey_responses?select=*&order=id.asc'],
    ['abonos', '/rest/v1/order_payments?select=*&order=id.asc'], ['avisos_reposicion', '/rest/v1/restock_alerts?select=*&order=id.asc'], ['costos_privados', '/rest/v1/product_costs?select=*&order=product_id.asc'],
    ['cantidad_en_casa', '/rest/v1/product_stock?select=*&order=product_id.asc,size_index.asc'], ['lineas_de_pedido', '/rest/v1/order_items?select=*&order=order_id.asc,position.asc'],
  ];
  $('#backup-download').addEventListener('click', async () => {
    const st = $('#backup-status'), button = $('#backup-download');
    button.disabled = true; status(st, 'Preparando respaldo…');
    const backup = { tienda: 'Elite Scents RD', creado: new Date().toISOString(), aviso: 'Contiene datos personales de clientes. Guárdalo en un lugar privado y no lo compartas.', tablas: {}, sin_acceso: [] };
    try {
      for (const [name, path] of BACKUP_SOURCES) {
        try { backup.tablas[name] = await fetchAll(path); } catch (err) { if (!missing(err)) backup.sin_acceso.push(name + ': ' + err.message); }
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

  // --- Encuesta: ajustes, resultados por pregunta y descarga para Excel (las preguntas están en survey.js) ---
  const SURVEY_URL = 'https://elitescentsrd.github.io/encuesta.html';
  let surveyResponses = [], surveyCoupons = [], surveyBlocks = [];
  function surveyKpis() {
    const used = surveyCoupons.filter(c => Number(c.used_count) > 0).length;
    const surveyOrders = orders.filter(o => /^ES-/.test(String(o.coupon_code || '')) && String(o.status || 'nuevo') !== 'cancelado');
    const total = surveyOrders.reduce((sum, o) => sum + (window.EliteSales ? window.EliteSales.amountOf(o) : 0), 0);
    const byReason = reason => surveyBlocks.filter(b => b.reason === reason).length;
    $('#survey-kpis').replaceChildren(
      kpi('Respuestas', String(surveyResponses.length), ''),
      kpi('Cupones usados', used + ' de ' + surveyCoupons.length, surveyCoupons.length ? Math.round((used / surveyCoupons.length) * 100) + '% lo usó' : ''),
      kpi('Pedidos con cupón de encuesta', String(surveyOrders.length), rd(total) + ' en esos pedidos'),
      kpi('Intentos repetidos bloqueados', String(surveyBlocks.length), 'mismo teléfono o computadora: ' + byReason('dispositivo') + ' · misma cédula o teléfono: ' + byReason('identidad') + ' · misma conexión: ' + byReason('conexion'), surveyBlocks.length ? 'warn' : ''));
  }
  function renderSurveyResults() {
    const S = window.EliteSurvey, box = $('#survey-results');
    surveyKpis();
    if (!S || !surveyResponses.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Todavía no hay respuestas.'; box.replaceChildren(p); return; }
    box.replaceChildren(...S.tally(surveyResponses).map(q => {
      const block = document.createElement('div'); block.className = 'survey-result';
      const title = document.createElement('h3'); title.textContent = q.text + ' (' + q.answered + ')'; block.append(title);
      if (q.options) {
        for (const o of q.options) {
          const row = document.createElement('div'); row.className = 'survey-bar';
          const label = document.createElement('span'); label.textContent = o.label;
          const bar = document.createElement('progress'); bar.max = Math.max(q.answered, 1); bar.value = o.count; bar.setAttribute('aria-label', o.label + ': ' + o.count);
          const count = document.createElement('strong'); count.textContent = o.count + ' (' + o.percent + '%)';
          row.append(label, bar, count); block.append(row);
        }
      } else {
        const list = document.createElement('ul'); list.className = 'survey-texts';
        for (const t of q.texts.slice(0, 15)) { const li = document.createElement('li'); li.textContent = t.text + ' · ' + dateText(t.date); list.append(li); }
        if (!q.texts.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Sin respuestas todavía.'; list.append(li); }
        block.append(list);
      }
      return block;
    }));
  }
  async function loadSurvey() {
    const notice = $('#survey-notice'), form = $('#survey-form');
    try {
      const [settings] = await api('/rest/v1/store_settings?select=survey_enabled,survey_amount,survey_valid_days,survey_min_subtotal,survey_ip_days&id=eq.true');
      surveyResponses = await fetchAll('/rest/v1/survey_responses?select=id,created_at,coupon_code,answers&order=created_at.desc');
      surveyCoupons = await fetchAll('/rest/v1/coupons?select=code,used_count,ends_at,value&source=eq.encuesta');
      surveyBlocks = await fetchAll('/rest/v1/survey_blocks?select=reason,created_at&order=created_at.desc');
      if (settings) { const f = form.elements; f.survey_enabled.checked = Boolean(settings.survey_enabled); f.survey_amount.value = Number(settings.survey_amount); f.survey_valid_days.value = settings.survey_valid_days; f.survey_min_subtotal.value = Number(settings.survey_min_subtotal); f.survey_ip_days.value = settings.survey_ip_days; }
      notice.classList.add('hidden'); form.classList.remove('hidden');
    } catch (err) {
      surveyResponses = []; surveyCoupons = []; surveyBlocks = []; notice.classList.remove('hidden'); form.classList.add('hidden');
      notice.textContent = /survey|schema cache|could not find|column|relation/i.test(err.message) ? 'Para usar la encuesta falta aplicar la migración "encuesta" en Supabase (SQL Editor).' : 'No se pudo cargar la encuesta: ' + err.message;
    }
    renderSurveyResults();
  }
  $('#survey-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget.elements, st = $('#survey-status');
    const body = { survey_enabled: f.survey_enabled.checked, survey_amount: Number(f.survey_amount.value), survey_valid_days: Number(f.survey_valid_days.value), survey_min_subtotal: Number(f.survey_min_subtotal.value) || 0, survey_ip_days: Number(f.survey_ip_days.value), updated_at: new Date().toISOString() };
    if (!(Number.isInteger(body.survey_ip_days) && body.survey_ip_days >= 0 && body.survey_ip_days <= 365)) { status(st, 'Los días de la misma conexión deben ser de 0 a 365.', 'error'); return; }
    if (!(body.survey_amount >= 1 && body.survey_amount <= 5000)) { status(st, 'El cupón debe ser de RD$1 a RD$5,000.', 'error'); return; }
    if (!(Number.isInteger(body.survey_valid_days) && body.survey_valid_days >= 1 && body.survey_valid_days <= 365)) { status(st, 'La validez debe ser de 1 a 365 días.', 'error'); return; }
    if (body.survey_min_subtotal < 0) { status(st, 'La compra mínima no puede ser negativa.', 'error'); return; }
    status(st, 'Guardando…');
    try { await api('/rest/v1/store_settings?id=eq.true', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) }); status(st, 'Ajustes guardados.', 'success'); await loadSurvey(); }
    catch (err) { status(st, err.message, 'error'); }
  });
  $('#survey-refresh').addEventListener('click', loadSurvey);
  $('#survey-copy').addEventListener('click', async () => {
    const button = $('#survey-copy');
    try { await navigator.clipboard.writeText(SURVEY_URL); button.textContent = 'Copiado ✓'; setTimeout(() => { button.textContent = 'Copiar enlace'; }, 1500); }
    catch { prompt('Copia el enlace de la encuesta:', SURVEY_URL); }
  });
  $('#survey-csv').addEventListener('click', () => {
    const st = $('#survey-csv-status');
    if (!window.EliteSurvey || !surveyResponses.length) { status(st, 'Todavía no hay respuestas para descargar.', 'error'); return; }
    const blob = new Blob([window.EliteSurvey.toCsv(surveyResponses)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'encuesta-elite-scents-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    status(st, surveyResponses.length + ' respuestas descargadas. Ábrelas con Excel.', 'success');
  });

  // --- Cobros, «Avísame cuando llegue», lista de compra, costos privados y ganancia (los cálculos viven en finanzas.js) ---
  const F = window.EliteFinanzas;
  let payments = [], paymentsReady = null, alerts = [], alertsReady = null, costRows = new Map(), costsReady = null, pricingParams = null;
  const MIGRATION_NOTE = 'falta aplicar la migración "funciones y perfumes nuevos" en Supabase (SQL Editor).';
  // Solo «no existe» (tabla, columna o función sin la migración); un error de validación («violates check constraint») se muestra tal cual.
  const missing = err => /schema cache|could not find the|does not exist|42P01|42703|PGRST20[2-5]/i.test(String(err?.message || err));
  const todayInput = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const dayText = v => v ? new Date(String(v).length === 10 ? v + 'T12:00:00' : v).toLocaleDateString('es-DO', { dateStyle: 'medium' }) : '—';
  const cell = (text, className) => { const td = document.createElement('td'); td.textContent = text; if (className) td.className = className; return td; };
  const tag = (text, kind) => { const s = document.createElement('span'); s.className = 'tag ' + (kind || ''); s.textContent = text; return s; };
  const button = (text, onClick, secondary = true) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (secondary ? ' btn-secondary' : ''); b.textContent = text; b.addEventListener('click', onClick); return b; };
  const costsOf = id => (costRows.get(Number(id))?.costs || []).map(Number).filter(n => n > 0);
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function copyText(text, el) {
    try { await navigator.clipboard.writeText(text); status(el, 'Copiado ✓ Pégalo en WhatsApp.', 'success'); }
    catch { prompt('Copia este texto:', text); }
  }

  // ---------------- Líneas de pedido y cantidad en casa (script «LÍNEAS DE PEDIDO Y CANTIDAD EN CASA», 3-oct)
  // Sin el script, todo sigue como antes: los cálculos leen el texto de cada pedido y no se lleva la cantidad.
  let orderLines = null, stockRows = new Map(), stockReady = null, stockVisible = 30;
  const STOCK_PAGE = 30;
  async function loadOrderData() {
    const [lines, stock] = await Promise.all([
      fetchAll('/rest/v1/order_items?select=order_id,position,product_id,name,size,size_index,qty,stock_taken&order=order_id.asc,position.asc').catch(() => null),
      fetchAll('/rest/v1/product_stock?select=product_id,size_index,qty').catch(() => null),
    ]);
    orderLines = lines && F ? F.groupLines(lines) : null;
    stockReady = Array.isArray(stock);
    stockRows = new Map();
    for (const r of stock || []) { const id = Number(r.product_id), list = stockRows.get(id) || []; list[Number(r.size_index)] = Number(r.qty); stockRows.set(id, list); }
  }
  const sizesOf = p => String(p?.size || '').split('/').map(s => s.trim()).filter(Boolean);
  const stockLabel = id => stockRows.has(Number(id)) ? [...stockRows.get(Number(id))].map(n => n ?? 0).join(' / ') : '';
  const stockTotal = id => (stockRows.get(Number(id)) || []).reduce((s, n) => s + (Number(n) || 0), 0);
  // «2» o «2 / 1» (una cantidad por tamaño). Vacío = dejar de llevar la cuenta (null).
  function parseStock(raw, sizeText) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const parts = text.split('/').map(s => s.trim()), sizes = Math.max(1, String(sizeText || '').split('/').filter(s => s.trim()).length);
    if (parts.some(s => !/^\d{1,4}$/.test(s))) throw new Error('La cantidad en casa va en números enteros, por ejemplo 2 (o 2 / 1 si tiene dos tamaños).');
    if (parts.length !== sizes) throw new Error('Escribe una cantidad por tamaño (' + sizes + '), separadas por «/». Por ejemplo: ' + Array(sizes).fill('1').join(' / ') + '.');
    return parts.map(Number);
  }
  async function saveStock(productId, qty) {
    const id = Number(productId), had = stockRows.has(id);
    if (qty === null) {
      if (!had) return '';
      await api('/rest/v1/product_stock?product_id=eq.' + id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      stockRows.delete(id); return 'Ya no se lleva la cantidad en casa de este perfume.';
    }
    await api('/rest/v1/product_stock?on_conflict=product_id,size_index', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(qty.map((n, i) => ({ product_id: id, size_index: i, qty: n }))) });
    if (had && stockRows.get(id).length > qty.length) await api('/rest/v1/product_stock?product_id=eq.' + id + '&size_index=gte.' + qty.length, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    stockRows.set(id, qty); return 'Cantidad en casa guardada.';
  }
  function stockTags(p, box) {
    box.replaceChildren(tag(p.active === false ? 'Oculto' : (availabilityText[p.availability] || '—'), p.availability === 'disponible' && p.active !== false ? 'ok' : 'warn'));
    const left = Number(p.stock_left);
    if (p.availability === 'disponible' && Number.isInteger(left) && left >= 1 && left <= 3) box.append(' ', tag(left === 1 ? '¡Queda 1!' : '¡Quedan ' + left + '!', 'warn'));
  }
  function stockRow(p) {
    const tr = document.createElement('tr'), inCell = document.createElement('td'), input = document.createElement('input'), state = document.createElement('td'), actions = document.createElement('td');
    input.className = 'cost-input'; input.inputMode = 'numeric'; input.maxLength = 40; input.value = stockLabel(p.id);
    input.placeholder = sizesOf(p).length > 1 ? sizesOf(p).map(() => '0').join(' / ') : 'sin contar';
    input.setAttribute('aria-label', 'Cantidad en casa de ' + p.name + (p.size ? ' (' + p.size + ')' : ''));
    inCell.append(input); stockTags(p, state); actions.className = 'admin-actions';
    const save = button('Guardar', async () => {
      const st = $('#stock-status'); save.disabled = true;
      try {
        const msg = await saveStock(p.id, parseStock(input.value, p.size));
        // La base de datos ajusta sola la disponibilidad y «¡Quedan…!»: se lee de nuevo este perfume.
        const fresh = await api('/rest/v1/products?id=eq.' + encodeURIComponent(p.id) + '&select=*');
        if (Array.isArray(fresh) && fresh[0]) { Object.assign(p, fresh[0]); stockTags(p, state); }
        input.value = stockLabel(p.id); status(st, p.name + ': ' + (msg || 'sin cambios.'), 'success'); renderStockKpis();
      } catch (err) { status(st, p.name + ': ' + err.message, 'error'); save.disabled = false; }
    }, false);
    save.disabled = true;
    input.addEventListener('input', () => { save.disabled = input.value.trim() === stockLabel(p.id); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!save.disabled) save.click(); } });
    actions.append(save); tr.append(cell(p.name), cell(p.size || '—'), inCell, state, actions);
    return tr;
  }
  function renderStockKpis() {
    const tracked = products.filter(p => stockRows.has(Number(p.id)));
    const low = tracked.filter(p => { const t = stockTotal(p.id); return t >= 1 && t <= 3; }), zero = tracked.filter(p => stockTotal(p.id) === 0);
    $('#stock-kpis').replaceChildren(kpi('Perfumes con cantidad', tracked.length + ' de ' + products.length, tracked.length ? '' : 'empieza por los que más vendes'),
      kpi('Unidades en casa', String(tracked.reduce((s, p) => s + stockTotal(p.id), 0)), ''),
      kpi('Pocas unidades', String(low.length), '3 o menos: la tienda dice «¡Quedan…!»', low.length ? 'warn' : ''),
      kpi('En 0', String(zero.length), 'se muestran «Agotado»', zero.length ? 'warn' : ''));
  }
  function renderStock() {
    if (!$('#stock-body')) return;
    const notice = $('#stock-notice'), body = $('#stock-body');
    if (stockReady !== true) {
      notice.classList.remove('hidden'); notice.textContent = 'Para llevar la cantidad en casa falta aplicar el script «LÍNEAS DE PEDIDO Y CANTIDAD EN CASA» (3 de octubre) en Supabase.';
      $('#stock-kpis').replaceChildren(); body.replaceChildren(); $('#stock-count').textContent = ''; $('#stock-more').classList.add('hidden'); return;
    }
    notice.classList.add('hidden'); renderStockKpis();
    const q = $('#stock-search').value.trim().toLocaleLowerCase('es'), view = $('#stock-view').value;
    const list = products.filter(p => {
      const id = Number(p.id), has = stockRows.has(id), t = stockTotal(id);
      return (!q || (p.name + ' ' + (p.brand || '')).toLocaleLowerCase('es').includes(q)) &&
        (view === 'all' || (view === 'tracked' && has) || (view === 'untracked' && !has) || (view === 'low' && has && t >= 1 && t <= 3) || (view === 'zero' && has && t === 0));
    });
    const shown = list.slice(0, stockVisible);
    $('#stock-count').textContent = list.length ? 'Mostrando ' + shown.length + ' de ' + list.length + ' perfumes.' : '';
    const more = $('#stock-more'); more.classList.toggle('hidden', list.length <= shown.length); more.textContent = 'Mostrar ' + Math.min(STOCK_PAGE, list.length - shown.length) + ' más';
    body.replaceChildren(...(shown.length ? shown.map(stockRow) : [emptyRow(5, view === 'tracked' ? 'Todavía no llevas la cantidad de ningún perfume: elige «Todos» y escribe cuántos tienes.' : 'No hay perfumes en esta vista.')]));
  }
  $('#stock-search').addEventListener('input', () => { stockVisible = STOCK_PAGE; renderStock(); });
  $('#stock-view').addEventListener('change', () => { stockVisible = STOCK_PAGE; renderStock(); });
  $('#stock-more').addEventListener('click', () => { stockVisible += STOCK_PAGE; renderStock(); });
  $('#stock-csv').addEventListener('click', () => {
    if (!F) return;
    const rows = [['id', 'perfume', 'tamaño', 'en casa', 'en la tienda']].concat(products.map(p => [p.id, p.name, p.size || '', stockLabel(p.id), p.active === false ? 'oculto' : (availabilityText[p.availability] || '')]));
    download('inventario-elite-scents-' + todayInput() + '.csv', F.toCsv(rows), 'text/csv;charset=utf-8');
  });

  // ---------------- Pedido a mano: elegir el perfume de la lista escribe la línea exacta («2x Nombre (tamaño)»)
  let orderPick = new Map(), orderAutoAmount = '';
  function fillOrderPicker() {
    const list = $('#order-products'); if (!list) return;
    orderPick = new Map();
    for (const p of products) {
      if (p.active === false) continue;
      // «60 / 100 ML» se muestra «60 ML» y «100 ML» (la unidad va solo en el último).
      const sizes = sizesOf(p), unit = ((sizes[sizes.length - 1] || '').match(/[a-z]+\.?$/i) || [''])[0];
      (sizes.length ? sizes : ['']).forEach((size, i) => orderPick.set(p.name + (size ? ' (' + (/^[0-9.,]+$/.test(size) && unit ? size + ' ' + unit : size) + ')' : ''), { p, i }));
    }
    list.replaceChildren(...[...orderPick.keys()].map(text => new Option(text)));
  }
  function orderTotal(text) {
    if (!F) return 0;
    let total = 0;
    for (const line of F.parseLines(text)) {
      const pick = orderPick.get(line.name + (line.size ? ' (' + line.size + ')' : '')) || orderPick.get(line.name);
      if (!pick) return 0; // una línea escrita a mano: el total lo pones tú
      const prices = F.amounts(pick.p.price); total += line.qty * (prices[Math.min(pick.i, prices.length - 1)] || 0);
    }
    return total;
  }
  $('#order-pick-add').addEventListener('click', () => {
    const orderForm = $('#order-form'), pick = $('#order-pick'), qty = Math.max(1, Math.min(99, Math.round(Number($('#order-pick-qty').value) || 1)));
    const text = pick.value.trim(), el = $('#order-status');
    if (!orderPick.has(text)) { status(el, 'Elige el perfume de la lista que aparece al escribir (así el pedido queda con el nombre exacto).', 'error'); pick.focus(); return; }
    const items = orderForm.elements.items, amount = orderForm.elements.amount;
    items.value = (items.value.trim() ? items.value.trim() + '\n' : '') + qty + 'x ' + text;
    const total = orderTotal(items.value);
    if (total && (!amount.value.trim() || amount.value === orderAutoAmount)) { orderAutoAmount = 'RD$' + total.toLocaleString('en-US'); amount.value = orderAutoAmount; }
    pick.value = ''; $('#order-pick-qty').value = 1; status(el, ''); pick.focus();
  });

  async function loadFinanzas() {
    await Promise.all([loadPayments(), loadAlerts(), loadCosts()]);
    renderFinanzas();
  }
  const hasInspired = () => Object.prototype.hasOwnProperty.call(products[0] || {}, 'inspired_by');
  function renderFinanzas() {
    renderOrders();
    $('#inspired-label').classList.toggle('hidden', products.length > 0 && !hasInspired());
    ['#cost-label', '#strategy-label'].forEach(sel => $(sel).classList.toggle('hidden', costsReady === false || !F));
    ['#stock-label', '#stock-help'].forEach(sel => $(sel).classList.toggle('hidden', stockReady !== true));
    renderStock();
    if (!F) return;
    renderReceivables(); renderRestock(); renderPurchase(); renderCosts(); renderProfit(); updateSuggestion();
  }

  // ---------------- Cuentas por cobrar y abonos
  async function loadPayments() {
    const notice = $('#receivables-notice');
    try { payments = await fetchAll('/rest/v1/order_payments?select=*&order=paid_on.asc,id.asc'); paymentsReady = true; notice.classList.add('hidden'); }
    catch (err) { payments = []; paymentsReady = false; notice.classList.remove('hidden'); notice.textContent = missing(err) ? 'Para registrar abonos ' + MIGRATION_NOTE : 'No se pudieron cargar los abonos: ' + err.message; }
  }
  const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
  const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const oldDelivered = rows => rows.filter(r => String(r.order.status) === 'entregado' && r.paid === 0 && r.due > 0 && Date.parse(r.order.created_at) < startOfToday().getTime());
  function renderReceivables() {
    if (!F || !$('#receivables-body')) return;
    const b = F.balances(orders, payments), t = b.totals, q = $('#receivables-search').value.trim().toLocaleLowerCase('es'), view = $('#receivables-view').value;
    $('#receivables-kpis').replaceChildren(
      kpi('Por cobrar', rd(t.due), t.open + ' pedido(s) de ' + t.customers + ' cliente(s)', t.due > 0 ? 'warn' : ''),
      kpi('Cobrado este mes', rd(F.collected(payments, startOfMonth(), null)), ''),
      kpi('Abonos registrados', String(payments.length), rd(t.paid) + ' en total'));
    const list = b.rows.filter(r => (view === 'all' || (view === 'open' ? r.due > 0 : r.total > 0 && r.due <= 0)) &&
      (!q || [r.order.customer_name, r.order.phone, '#' + r.order.id].join(' ').toLocaleLowerCase('es').includes(q)));
    $('#receivables-body').replaceChildren(...(list.length ? list.map(receivableRow) : [emptyRow(8, view === 'open' ? 'No hay saldos pendientes.' : 'No hay pedidos en esta vista.')]));
    const old = oldDelivered(b.rows), settle = $('#receivables-settle-old');
    settle.classList.toggle('hidden', !paymentsReady || !old.length);
    settle.textContent = 'Marcar como pagados ' + old.length + ' pedido(s) entregados antes de hoy y sin abonos';
  }
  function receivableRow(r) {
    const o = r.order, tr = document.createElement('tr');
    const who = document.createElement('td'); who.textContent = o.customer_name || '—';
    if (o.phone) { const small = document.createElement('small'); small.className = 'order-balance'; small.textContent = o.phone; who.append(small); }
    const due = document.createElement('td'); due.className = 'num'; due.append(r.total ? (r.due > 0 ? tag(rd(r.due), r.paid > 0 ? 'warn' : 'bad') : tag('Pagado', 'ok')) : tag('Sin total', 'warn'));
    const actions = document.createElement('td'); actions.className = 'admin-actions';
    if (paymentsReady && r.total > 0 && r.due > 0) actions.append(button('Registrar abono', () => openPayment(r), false));
    if (paymentsReady && payments.some(p => String(p.order_id) === String(o.id))) actions.append(button('Ver abonos', () => openPayment(r)));
    if (r.due > 0 && o.phone) { const wa = document.createElement('a'); wa.className = 'btn btn-secondary'; wa.target = '_blank'; wa.rel = 'noopener noreferrer'; wa.href = F.waLink(o.phone, F.reminderText(r)); wa.textContent = 'Recordar por WhatsApp'; actions.append(wa); }
    tr.append(cell('#' + o.id), who, cell(dayText(o.created_at)), cell(r.total ? rd(r.total) : (o.amount || '—'), 'num'), cell(rd(r.paid), 'num'), due, cell(dayText(r.last)), actions);
    return tr;
  }
  let paymentRow = null;
  function openPayment(r, keepStatus) {
    paymentRow = r; const f = $('#payment-form');
    $('#payment-title').textContent = 'Abonos del pedido #' + r.order.id + ' · ' + (r.order.customer_name || '');
    $('#payment-summary').textContent = 'Total ' + rd(r.total) + ' · Abonado ' + rd(r.paid) + ' · Pendiente ' + rd(r.due) + (r.order.items ? ' · ' + String(r.order.items).split(/\r?\n/).join(', ') : '');
    f.elements.amount.value = r.due > 0 ? Math.round(r.due) : ''; f.elements.method.value = 'efectivo'; f.elements.paid_on.value = todayInput(); f.elements.note.value = '';
    f.querySelectorAll('button[type="submit"],#payment-full').forEach(b => b.classList.toggle('hidden', !(r.due > 0)));
    if (!keepStatus) status($('#payment-status'), '');
    const mine = payments.filter(p => String(p.order_id) === String(r.order.id));
    $('#payment-list').replaceChildren(...(mine.length ? mine.map(p => {
      const li = document.createElement('li'); li.textContent = dayText(p.paid_on) + ' · ' + rd(p.amount) + ' · ' + p.method + (p.note ? ' · ' + p.note : '');
      li.append(button('Borrar', async () => {
        if (!confirm('¿Borrar el abono de ' + rd(p.amount) + ' del ' + dayText(p.paid_on) + '?')) return;
        try { await api('/rest/v1/order_payments?id=eq.' + encodeURIComponent(p.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); payments = payments.filter(x => x.id !== p.id); afterPayment(); }
        catch (err) { alert(err.message); }
      }));
      return li;
    }) : [(() => { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Todavía no hay abonos.'; return li; })()]));
    const dialog = $('#payment-dialog'); if (!dialog.open) dialog.showModal();
  }
  function afterPayment() {
    renderFinanzas(); renderSales();
    if (paymentRow) { const fresh = F.balances(orders, payments).rows.find(x => String(x.order.id) === String(paymentRow.order.id)); if (fresh) openPayment(fresh, true); }
  }
  async function savePayment(amount) {
    const f = $('#payment-form'), st = $('#payment-status'), r = paymentRow;
    if (!r) return;
    const value = Number(String(amount ?? f.elements.amount.value).replace(/[^0-9.]/g, ''));
    if (!(value > 0)) { status(st, 'Escribe el monto del abono.', 'error'); return; }
    if (value > r.due + 0.5 && !confirm('El abono (' + rd(value) + ') es mayor que lo pendiente (' + rd(r.due) + '). ¿Guardarlo de todos modos?')) return;
    const body = { order_id: r.order.id, amount: Math.round(value * 100) / 100, method: f.elements.method.value, paid_on: f.elements.paid_on.value || todayInput(), note: f.elements.note.value.trim() };
    status(st, 'Guardando…');
    try { const saved = await api('/rest/v1/order_payments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) }); payments.push(...(Array.isArray(saved) ? saved : [])); afterPayment(); status(st, 'Abono guardado ✓', 'success'); }
    catch (err) { status(st, missing(err) ? 'Para registrar abonos ' + MIGRATION_NOTE : err.message, 'error'); }
  }
  $('#payment-form').addEventListener('submit', e => { e.preventDefault(); savePayment(); });
  $('#payment-full').addEventListener('click', () => { if (paymentRow) savePayment(paymentRow.due); });
  $('#payment-close').addEventListener('click', () => $('#payment-dialog').close());
  $('#receivables-search').addEventListener('input', renderReceivables);
  $('#receivables-view').addEventListener('change', renderReceivables);
  $('#receivables-refresh').addEventListener('click', async () => { await loadPayments(); renderFinanzas(); renderSales(); });
  $('#receivables-settle-old').addEventListener('click', async () => {
    const old = oldDelivered(F.balances(orders, payments).rows), st = $('#receivables-status');
    if (!old.length) return;
    if (!confirm('Se registrará como pagado el total de ' + old.length + ' pedido(s) entregados antes de hoy que no tienen abonos (' + rd(old.reduce((s, r) => s + r.due, 0)) + '). Úsalo solo si esos clientes ya te pagaron. ¿Continuar?')) return;
    const body = old.map(r => ({ order_id: r.order.id, amount: r.due, method: 'otro', note: 'Pagado antes de usar cuentas por cobrar', paid_on: String(r.order.created_at).slice(0, 10) }));
    try { const saved = await api('/rest/v1/order_payments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) }); payments.push(...saved); status(st, old.length + ' pedido(s) marcados como pagados.', 'success'); renderFinanzas(); renderSales(); }
    catch (err) { status(st, err.message, 'error'); }
  });

  // ---------------- «Avísame cuando llegue»
  async function loadAlerts() {
    const notice = $('#restock-notice');
    try { alerts = await fetchAll('/rest/v1/restock_alerts?select=*&order=created_at.asc'); alertsReady = true; notice.classList.add('hidden'); }
    catch (err) { alerts = []; alertsReady = false; notice.classList.remove('hidden'); notice.textContent = missing(err) ? 'Para ver los avisos ' + MIGRATION_NOTE : 'No se pudieron cargar los avisos: ' + err.message; }
  }
  const availabilityText = { disponible: 'Disponible', agotado: 'Agotado', encargo: 'Por encargo' };
  function renderRestock() {
    if (!F || !$('#restock-body')) return;
    const byId = new Map(products.map(p => [Number(p.id), p])), view = $('#restock-view').value;
    const waiting = alerts.filter(a => a.status === 'pendiente'), ready = waiting.filter(a => byId.get(Number(a.product_id))?.availability === 'disponible');
    const summary = $('#restock-summary');
    summary.textContent = waiting.length ? waiting.length + ' persona(s) esperando ' + new Set(waiting.map(a => a.product_id)).size + ' perfume(s)' + (ready.length ? ' · ' + ready.length + ' ya se pueden avisar' : '') : 'Nadie está esperando un perfume ahora mismo.';
    summary.classList.toggle('has-pending', ready.length > 0);
    const list = view === 'sent' ? alerts.filter(a => a.status === 'avisado') : view === 'ready' ? ready : waiting;
    $('#restock-body').replaceChildren(...(list.length ? list.map(a => {
      const p = byId.get(Number(a.product_id)) || { id: a.product_id, name: 'Perfume #' + a.product_id, availability: '' }, tr = document.createElement('tr');
      const state = document.createElement('td'); state.append(tag(availabilityText[p.availability] || 'Oculto', p.availability === 'disponible' ? 'ok' : 'warn'));
      const actions = document.createElement('td'); actions.className = 'admin-actions';
      if (a.status === 'pendiente') {
        const wa = document.createElement('a'); wa.className = 'btn'; wa.target = '_blank'; wa.rel = 'noopener noreferrer'; wa.href = F.waLink(a.phone, F.restockText(a.customer_name, p)); wa.textContent = 'Avisar por WhatsApp';
        wa.addEventListener('click', async () => {
          try { await api('/rest/v1/restock_alerts?id=eq.' + encodeURIComponent(a.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'avisado', notified_at: new Date().toISOString() }) }); a.status = 'avisado'; a.notified_at = new Date().toISOString(); renderRestock(); renderPurchase(); }
          catch (err) { alert(err.message); }
        });
        actions.append(wa);
      } else actions.append(tag('Avisado ' + dayText(a.notified_at), 'ok'));
      actions.append(button('Quitar', async () => {
        if (!confirm('¿Quitar el aviso de ' + a.customer_name + '?')) return;
        try { await api('/rest/v1/restock_alerts?id=eq.' + encodeURIComponent(a.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); alerts = alerts.filter(x => x.id !== a.id); renderRestock(); renderPurchase(); }
        catch (err) { alert(err.message); }
      }));
      tr.append(cell(p.name + (p.size ? ' · ' + p.size : '')), state, cell(a.customer_name), cell(String(a.phone).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')), cell(dayText(a.created_at)), actions);
      return tr;
    }) : [emptyRow(6, view === 'ready' ? 'Ningún perfume esperado está disponible todavía.' : 'No hay avisos en esta vista.')]));
  }
  $('#restock-view').addEventListener('change', renderRestock);
  $('#restock-refresh').addEventListener('click', async () => { await loadAlerts(); renderRestock(); renderPurchase(); });

  // ---------------- Lista de compra para La Grada
  const purchaseEdits = new Map();
  let purchaseRows = [];
  function renderPurchase() {
    if (!F || !$('#purchase-body')) return;
    const { rows, unmatched } = F.purchaseList(orders, products, alerts, { includeAvailable: $('#purchase-available').checked, includeWaiting: $('#purchase-waiting').checked, lines: orderLines, stock: stockReady === true ? stockRows : null });
    purchaseRows = rows.map(r => { const key = r.product.id + '|' + r.size; return { ...r, key, buy: purchaseEdits.has(key) ? purchaseEdits.get(key) : ((r.need !== undefined ? r.need : r.qty) || (r.waiting ? 1 : 0)) }; });
    const unitCost = r => { const c = costsOf(r.product.id); return c.length ? c[Math.min(F.sizeIndex(r.product, r.size), c.length - 1)] : null; };
    const totals = () => {
      const units = purchaseRows.reduce((s, r) => s + r.buy, 0), priced = purchaseRows.filter(r => r.buy > 0 && unitCost(r) !== null);
      $('#purchase-kpis').replaceChildren(kpi('Unidades a comprar', String(units), purchaseRows.filter(r => r.buy > 0).length + ' perfume(s)'),
        kpi('Costo estimado', priced.length ? rd(priced.reduce((s, r) => s + r.buy * unitCost(r), 0)) : '—', priced.length < purchaseRows.filter(r => r.buy > 0).length ? 'algunos sin costo' : 'según tus costos'));
    };
    $('#purchase-body').replaceChildren(...(purchaseRows.length ? purchaseRows.map(r => {
      const tr = document.createElement('tr'), qtyCell = document.createElement('td'), input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = '99'; input.step = '1'; input.value = r.buy; input.className = 'purchase-qty'; input.setAttribute('aria-label', 'Cantidad a comprar de ' + r.product.name);
      const sub = cell('');
      const refresh = () => { const c = unitCost(r); sub.textContent = c !== null && r.buy > 0 ? rd(c * r.buy) : '—'; };
      input.addEventListener('input', () => { r.buy = Math.max(0, Math.min(99, Math.round(Number(input.value) || 0))); purchaseEdits.set(r.key, r.buy); refresh(); totals(); });
      qtyCell.append(input); refresh();
      const state = document.createElement('td'); state.append(tag(availabilityText[r.product.availability] || '—', r.product.availability === 'disponible' ? 'ok' : 'warn'));
      tr.append(qtyCell, cell(r.product.name), cell(r.size || '—'), cell(r.qty ? r.qty + ' (pedido ' + r.orders.map(id => '#' + id).join(', ') + ')' + (r.home !== undefined ? ' · en casa ' + r.home + (r.covered ? ' · ya apartados ' + r.covered : '') : '') : '—'), cell(r.waiting ? String(r.waiting) : '—'), state, cell(unitCost(r) !== null ? rd(unitCost(r)) : '—', 'num'), sub);
      return tr;
    }) : [emptyRow(8, 'No hay nada pendiente por comprar.')]));
    totals();
    const box = $('#purchase-unmatched'); box.textContent = unmatched.length ? 'Líneas de pedidos que no coinciden con un perfume de la tienda (revísalas a mano): ' + unmatched.map(u => '#' + u.order + ' ' + u.text).join(' · ') : '';
  }
  ['#purchase-available', '#purchase-waiting'].forEach(sel => $(sel).addEventListener('change', renderPurchase));
  $('#purchase-refresh').addEventListener('click', async () => { await loadAll(); await loadAlerts(); renderFinanzas(); });
  $('#purchase-copy').addEventListener('click', () => {
    if (!purchaseRows.some(r => r.buy > 0)) { status($('#purchase-status'), 'No hay cantidades para comprar.', 'error'); return; }
    copyText(F.purchaseText(purchaseRows), $('#purchase-status'));
  });
  $('#purchase-csv').addEventListener('click', () => {
    const rows = [['cantidad', 'perfume', 'tamaño', 'en pedidos', 'personas esperando', 'pedidos']].concat(purchaseRows.filter(r => r.buy > 0).map(r => [r.buy, r.product.name, r.size, r.qty, r.waiting, r.orders.map(id => '#' + id).join(' ')]));
    download('compra-la-grada-' + todayInput() + '.csv', F.toCsv(rows), 'text/csv;charset=utf-8');
  });

  // ---------------- Costos privados, fórmula y precio sugerido
  async function loadCosts() {
    const notice = $('#costs-notice');
    try {
      const rows = await fetchAll('/rest/v1/product_costs?select=*');
      costRows = new Map(rows.map(r => [Number(r.product_id), r]));
      const settings = await api('/rest/v1/store_settings?select=pricing&id=eq.true');
      pricingParams = Array.isArray(settings) && settings[0] ? settings[0].pricing : null; costsReady = true; notice.classList.add('hidden');
    } catch (err) { costRows = new Map(); pricingParams = null; costsReady = false; notice.classList.remove('hidden'); notice.textContent = missing(err) ? 'Para usar costos ' + MIGRATION_NOTE : 'No se pudieron cargar los costos: ' + err.message; }
    fillPricingForm();
  }
  function fillPricingForm() {
    const f = $('#pricing-form').elements, p = F && F.validParams(pricingParams);
    if (!p) return;
    f.logistica.value = p.logistica; f.ganancia_minima.value = p.ganancia_minima;
    f.curva.value = p.curva.map(([c, m]) => c + ', ' + Math.round(m * 1000) / 10).join('\n');
    for (const k of ['gancho', 'normal', 'exclusivo']) { f[k + '_factor'].value = p.estrategias[k].factor; f[k + '_descuento'].value = Math.round(p.estrategias[k].descuento * 1000) / 10; }
  }
  $('#pricing-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget.elements, st = $('#pricing-status');
    const curva = String(f.curva.value).split(/\r?\n/).map(l => l.split(/[,;\t]/).map(v => Number(v.replace(/[^0-9.]/g, '')))).filter(x => x.length >= 2 && x[0] > 0 && x[1] >= 0).map(([c, m]) => [c, m / 100]);
    const params = { logistica: Number(f.logistica.value), ganancia_minima: Number(f.ganancia_minima.value), curva, estrategias: {} };
    for (const k of ['gancho', 'normal', 'exclusivo']) params.estrategias[k] = { factor: Number(f[k + '_factor'].value), descuento: Number(f[k + '_descuento'].value) / 100 };
    if (!F.validParams(params)) { status(st, 'Revisa la fórmula: faltan números o la curva está vacía.', 'error'); return; }
    status(st, 'Guardando…');
    try { await api('/rest/v1/store_settings?id=eq.true', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ pricing: params, updated_at: new Date().toISOString() }) }); pricingParams = params; status(st, 'Fórmula guardada.', 'success'); renderFinanzas(); }
    catch (err) { status(st, missing(err) ? 'Para guardar la fórmula ' + MIGRATION_NOTE : err.message, 'error'); }
  });
  const COSTS_PAGE = 50; let costsVisible = COSTS_PAGE; const costsSelected = new Set();
  // review: el precio de hoy revisado con la fórmula y las reglas de siempre (±RD$50, competencia, tope de RD$6,950).
  // Los perfumes en oferta no se marcan para cambiar (se manejan en «Ofertas»); su ganancia se mide con el precio rebajado.
  function costInfo(p) {
    const row = costRows.get(Number(p.id)), costs = costsOf(p.id), strategy = row?.strategy || 'normal', competitor = row?.competitor_price ? Number(row.competitor_price) : null;
    const review = costs.length ? F.reviewPrice(p, costs, strategy, pricingParams, competitor) : null, current = costs.length ? F.currentProfit(p, costs, pricingParams) : null;
    const offer = p.original_price && costs.length ? F.currentProfit({ price: p.price }, costs, pricingParams) : null;
    const params = F.validParams(pricingParams), below = Boolean(params && (offer || current) && (offer || current).some(c => c.profit < params.ganancia_minima));
    return { costs, strategy, competitor, review, suggestion: review ? review.suggestion : null, current, offer, below, differs: Boolean(review && review.differs && !p.original_price) };
  }
  function renderCosts() {
    if (!F || !$('#costs-body')) return;
    const q = $('#costs-search').value.trim().toLocaleLowerCase('es'), view = $('#costs-view').value, params = F.validParams(pricingParams);
    const all = products.map(p => ({ p, info: costInfo(p) }));
    const withCost = all.filter(x => x.info.costs.length), below = withCost.filter(x => x.info.below), differs = withCost.filter(x => x.info.differs);
    const margins = withCost.map(x => x.info.current).filter(Boolean).map(c => c[0].margin);
    $('#costs-kpis').replaceChildren(
      kpi('Perfumes con costo', withCost.length + ' de ' + products.length, costsReady === false ? 'falta la migración' : ''),
      kpi('Ganancia promedio', margins.length ? Math.round(margins.reduce((s, m) => s + m, 0) / margins.length * 100) + '%' : '—', 'sobre costo + logística'),
      kpi('Bajo la ganancia mínima', String(below.length), params ? 'menos de ' + rd(params.ganancia_minima) + ' por unidad' : 'guarda la fórmula', below.length ? 'warn' : ''),
      kpi('Precio distinto al sugerido', String(differs.length), params ? '' : 'sin fórmula no hay sugeridos'));
    const list = all.filter(({ p, info }) => (!q || (p.name + ' ' + (p.brand || '')).toLocaleLowerCase('es').includes(q)) &&
      (view === 'all' || (view === 'diff' && info.differs) || (view === 'below' && info.below) || (view === 'nocost' && !info.costs.length)));
    const shown = list.slice(0, costsVisible);
    $('#costs-count').textContent = list.length ? 'Mostrando ' + shown.length + ' de ' + list.length + ' perfumes.' : 'No hay perfumes en esta vista.';
    const more = $('#costs-more'); more.classList.toggle('hidden', list.length <= shown.length); more.textContent = 'Mostrar ' + Math.min(COSTS_PAGE, list.length - shown.length) + ' más';
    $('#costs-body').replaceChildren(...shown.map(({ p, info }) => costRow(p, info)));
    const selectable = shown.filter(x => canApply(x.p, x.info)), selectAll = $('#costs-select-all');
    selectAll.disabled = !selectable.length; selectAll.checked = selectable.length > 0 && selectable.every(x => costsSelected.has(Number(x.p.id)));
  }
  const canApply = (p, info) => Boolean(info.review && info.differs && !p.original_price);
  function costRow(p, info) {
    const tr = document.createElement('tr'), pick = document.createElement('td'), check = document.createElement('input');
    check.type = 'checkbox'; check.disabled = !canApply(p, info); check.checked = costsSelected.has(Number(p.id)) && !check.disabled; check.setAttribute('aria-label', 'Seleccionar ' + p.name);
    check.addEventListener('change', () => { check.checked ? costsSelected.add(Number(p.id)) : costsSelected.delete(Number(p.id)); });
    pick.append(check);
    const costCell = document.createElement('td'), cost = document.createElement('input'); cost.className = 'cost-input'; cost.inputMode = 'decimal'; cost.value = info.costs.map(c => c.toLocaleString('en-US')).join(' / '); cost.setAttribute('aria-label', 'Costo de ' + p.name); costCell.append(cost);
    const stCell = document.createElement('td'), strategy = document.createElement('select'); strategy.className = 'cost-select';
    [['normal', 'Normal'], ['gancho', 'Gancho'], ['exclusivo', 'Exclusivo']].forEach(([v, t]) => strategy.append(new Option(t, v, false, info.strategy === v))); stCell.append(strategy);
    const compCell = document.createElement('td'), comp = document.createElement('input'); comp.className = 'cost-input'; comp.inputMode = 'decimal'; comp.placeholder = 'opcional'; comp.value = info.competitor ? info.competitor.toLocaleString('en-US') : ''; comp.setAttribute('aria-label', 'Precio de la competencia de ' + p.name); compCell.append(comp);
    const fmt = list => list.map(c => rd(c.profit) + ' (' + Math.round(c.margin * 100) + '%)').join(' / ');
    // En oferta, también la ganancia con el precio rebajado que pagan hoy los clientes.
    const profit = info.current ? fmt(info.current) + (info.offer ? ' · en oferta: ' + fmt(info.offer) : '') : '—';
    const suggestedCell = document.createElement('td'); suggestedCell.className = 'num';
    let sugProfit = '—';
    if (info.review) {
      const r = info.review, states = r.items.map(x => x.state), capped = r.items.some(x => x.capped);
      if (p.original_price) suggestedCell.append(r.suggestion.text + ' ', tag('en oferta', ''));
      else if (r.mismatch) suggestedCell.append(r.suggestion.text + ' ', tag('un costo por presentación', 'warn'));
      else if (info.differs) {
        suggestedCell.append(r.text + ' ', states.includes('bajo-piso') ? tag('pierdes ganancia', 'bad') : states.includes('alto') ? tag('más caro', 'warn') : states.includes('bajo') ? tag('puedes subir', 'warn') : '');
        sugProfit = F.currentProfit({ price: r.text }, info.costs, pricingParams).map(x => rd(x.profit)).join(' / ');
      } else suggestedCell.append(tag(states.includes('mercado') ? '✓ a nivel de la competencia' : '✓ al día', 'ok'));
      if (capped && !p.original_price) suggestedCell.append(document.createElement('br'), Object.assign(document.createElement('small'), { className: 'muted', textContent: 'La fórmula da ' + r.suggestion.text + '; se queda en RD$6,950 para seguir «Disponible».' }));
    } else suggestedCell.textContent = '—';
    const cur = document.createElement('td'); cur.textContent = (p.original_price || p.price || '—') + (p.original_price ? ' (en oferta: ' + p.price + ')' : '');
    const prof = document.createElement('td'); prof.append(info.below ? tag(profit, 'bad plain') : document.createTextNode(profit));
    const save = document.createElement('td'); save.append(button('Guardar', async () => {
      const costs = cost.value.split('/').map(v => Number(v.replace(/[^0-9.]/g, ''))).filter(v => v > 0);
      if (!costs.length) { alert('Escribe el costo (por ejemplo 2,650 o 2,650 / 3,400).'); return; }
      try { await upsertCosts([{ product_id: Number(p.id), costs, strategy: strategy.value, competitor_price: Number(comp.value.replace(/[^0-9.]/g, '')) || null }]); status($('#costs-status'), 'Costo de ' + p.name + ' guardado.', 'success'); renderFinanzas(); }
      catch (err) { status($('#costs-status'), missing(err) ? 'Para guardar costos ' + MIGRATION_NOTE : err.message, 'error'); }
    }));
    tr.append(pick, cell(p.name + (p.size ? ' · ' + p.size : '')), costCell, stCell, compCell, cur, prof, suggestedCell, cell(sugProfit, 'num'), save);
    return tr;
  }
  async function upsertCosts(rows) {
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map(r => ({ ...r, updated_at: now }));
      let saved;
      try { saved = await api('/rest/v1/product_costs?on_conflict=product_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(chunk) }); }
      catch (err) {
        // Una tabla de costos vieja (sin las columnas del panel): se arregla con un script, no escribiendo otra vez.
        if (/PGRST204|could not find the '\w+' column of 'product_costs'|42703/i.test(String(err?.message || err))) throw new Error('La tabla de costos de Supabase es una versión vieja: corre el script «REPARAR LA TABLA DE COSTOS» (3 de octubre) y vuelve a intentarlo.');
        throw err;
      }
      for (const r of saved || []) costRows.set(Number(r.product_id), r);
    }
  }
  $('#costs-search').addEventListener('input', () => { costsVisible = COSTS_PAGE; renderCosts(); });
  $('#costs-view').addEventListener('change', () => { costsVisible = COSTS_PAGE; renderCosts(); });
  $('#costs-more').addEventListener('click', () => { costsVisible += COSTS_PAGE; renderCosts(); });
  $('#costs-select-all').addEventListener('change', e => {
    const q = $('#costs-search').value.trim().toLocaleLowerCase('es');
    for (const p of products) { const info = costInfo(p); if (canApply(p, info) && (!q || (p.name + ' ' + (p.brand || '')).toLocaleLowerCase('es').includes(q))) e.target.checked ? costsSelected.add(Number(p.id)) : costsSelected.delete(Number(p.id)); }
    renderCosts();
  });
  $('#costs-apply').addEventListener('click', async () => {
    const st = $('#costs-status'), chosen = products.filter(p => costsSelected.has(Number(p.id))).map(p => ({ p, info: costInfo(p) })).filter(x => canApply(x.p, x.info));
    if (!chosen.length) { status(st, 'Selecciona perfumes con un precio sugerido distinto (los que están en oferta no se cambian aquí).', 'error'); return; }
    if (!confirm('¿Cambiar el precio de ' + chosen.length + ' perfume(s) al sugerido?\n\n' + chosen.slice(0, 12).map(x => x.p.name + ': ' + x.p.price + ' → ' + x.info.review.text).join('\n') + (chosen.length > 12 ? '\n…' : ''))) return;
    let ok = 0, failed = 0, last = '';
    for (const [i, { p, info }] of chosen.entries()) {
      status(st, 'Cambiando ' + (i + 1) + ' de ' + chosen.length + '…');
      try { await api('/rest/v1/products?id=eq.' + encodeURIComponent(p.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ price: info.review.text, updated_at: new Date().toISOString() }) }); ok++; costsSelected.delete(Number(p.id)); }
      catch (err) { failed++; last = err.message; }
    }
    status(st, ok + ' precio(s) cambiados' + (failed ? ', ' + failed + ' con error (' + last + ')' : '') + '.', failed ? 'error' : 'success');
    await loadAll(); renderFinanzas();
  });
  $('#costs-export').addEventListener('click', () => {
    const strategy = new Map([...costRows].map(([id, r]) => [id, r.strategy])), competitor = new Map([...costRows].map(([id, r]) => [id, r.competitor_price ? Number(r.competitor_price) : '']));
    const costs = new Map([...costRows].map(([id]) => [id, costsOf(id)]));
    download('costos-elite-scents-' + todayInput() + '.csv', F.costsCsv(products, costs, strategy, competitor), 'text/csv;charset=utf-8');
  });
  let costsImport = [];
  $('#costs-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const { rows, errors } = F.parseCostsCsv(await file.text(), products);
    costsImport = rows;
    $('#costs-import').classList.remove('hidden');
    $('#costs-import-summary').textContent = rows.length + ' perfume(s) con costo listo para guardar' + (errors.length ? ' · ' + errors.length + ' fila(s) con problema:' : '.');
    $('#costs-import-errors').replaceChildren(...errors.slice(0, 50).map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    $('#costs-import-save').disabled = !rows.length; status($('#costs-import-status'), '');
  });
  $('#costs-import-cancel').addEventListener('click', () => { costsImport = []; $('#costs-import').classList.add('hidden'); });
  $('#costs-import-save').addEventListener('click', async () => {
    const st = $('#costs-import-status');
    if (!costsImport.length) return;
    status(st, 'Guardando ' + costsImport.length + ' costo(s)…');
    try {
      await upsertCosts(costsImport.map(r => { const old = costRows.get(Number(r.product.id)); return { product_id: Number(r.product.id), costs: r.costs, strategy: r.strategy || old?.strategy || 'normal', competitor_price: r.competitor === undefined ? (old?.competitor_price ?? null) : r.competitor }; }));
      status(st, costsImport.length + ' costo(s) guardados.', 'success'); costsImport = []; $('#costs-import').classList.add('hidden'); renderFinanzas();
    } catch (err) { status(st, missing(err) ? 'Para guardar costos ' + MIGRATION_NOTE : err.message, 'error'); }
  });

  // ---------------- Ganancia por mes (resumen de ventas)
  function renderProfit() {
    if (!F || !$('#profit-body')) return;
    const params = F.validParams(pricingParams);
    if (!costRows.size || !params) { $('#profit-body').replaceChildren(emptyRow(7, costsReady === false ? 'Para calcular la ganancia ' + MIGRATION_NOTE : 'Carga tus costos y la fórmula (sección «Costos y precios») para ver la ganancia real.')); return; }
    const costs = new Map([...costRows].map(([id]) => [id, costsOf(id)]));
    const { months } = F.profitSummary(orders, products, costs, params, { months: 6, lines: orderLines });
    $('#profit-body').replaceChildren(...months.slice().reverse().map(m => {
      const tr = document.createElement('tr'), [y, mo] = m.month.split('-').map(Number);
      tr.append(cell(new Date(y, mo - 1, 1).toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })), cell(String(m.orders)), cell(rd(m.sales), 'num'), cell(rd(m.cost), 'num'), cell(rd(m.profit), 'num'), cell(m.sales ? Math.round(m.profit / m.sales * 100) + '%' : '—'), cell(String(m.unknown)));
      return tr;
    }));
  }
  // Datos del período para el resumen de ventas: cobrado, por cobrar y ganancia estimada.
  function financeKpis(range) {
    if (!F) return [];
    const out = [];
    if (paymentsReady) {
      out.push(kpi('Cobrado (abonos)', rd(F.collected(payments, range.start, range.end)), 'en el período'));
      const t = F.balances(orders, payments).totals; out.push(kpi('Por cobrar hoy', rd(t.due), t.open + ' pedido(s)', t.due > 0 ? 'warn' : ''));
    }
    const params = F.validParams(pricingParams);
    if (costRows.size && params) {
      const byName = F.productIndex(products), costs = new Map([...costRows].map(([id]) => [id, costsOf(id)]));
      const sold = orders.filter(o => F.SOLD.includes(String(o.status || 'nuevo')) && (!range.start || Date.parse(o.created_at) >= range.start.getTime()) && Date.parse(o.created_at) < range.end.getTime());
      const byId = new Map(products.map(p => [Number(p.id), p])), results = sold.map(o => F.orderProfit(o, byName, costs, params, orderLines, byId)), known = results.filter(r => r.known);
      out.push(kpi('Ganancia estimada', known.length ? rd(known.reduce((s, r) => s + r.profit, 0)) : '—', known.length + ' de ' + sold.length + ' pedido(s) con costo'));
    }
    return out;
  }

  // ---------------- Producto: «Inspirado en», costo privado y precio sugerido
  function updateSuggestion() {
    const box = $('#price-suggestion'); if (!box || !F) return;
    box.replaceChildren();
    const costs = String(form.elements.cost.value || '').split('/').map(v => Number(v.replace(/[^0-9.]/g, ''))).filter(v => v > 0);
    if (!costs.length) { box.textContent = costsReady ? 'Escribe el costo para ver el precio sugerido con tu fórmula (solo lo ves tú).' : ''; return; }
    if (!F.validParams(pricingParams)) { box.textContent = 'Guarda la fórmula en «Costos y precios» para ver el precio sugerido.'; return; }
    const id = Number(form.elements.id.value), row = costRows.get(id), current = normalizePrice(form.elements.price.value);
    const r = F.reviewPrice({ price: current, availability: form.elements.availability.value }, costs, form.elements.strategy.value, pricingParams, row?.competitor_price ? Number(row.competitor_price) : null);
    if (!r) return;
    const s = r.suggestion, profit = current ? F.currentProfit({ price: current }, costs, pricingParams) : null;
    box.append('Precio sugerido: ' + s.text + ' (ganancia ' + s.items.map(i => rd(i.profit)).join(' / ') + ')' + (profit ? ' · Con ' + current + ' ganas ' + profit.map(p => rd(p.profit)).join(' / ') : '') + ' ');
    if (r.items.some(x => x.capped)) box.append('· Para seguir «Disponible» (menos de RD$7,000): ' + r.text + ' ');
    else if (r.items.some(x => x.state === 'mercado') && !r.differs) box.append('· Tu precio ya está a nivel de la competencia ');
    if (r.mismatch) box.append('· Escribe un costo por presentación (ej.: 2,650 / 3,400) ');
    else if (r.differs) box.append(button('Usar el sugerido', () => { form.elements.price.value = r.text; updateSuggestion(); }));
  }
  ['cost', 'strategy', 'price'].forEach(name => form.elements[name].addEventListener('input', updateSuggestion));
  ['strategy', 'availability'].forEach(name => form.elements[name].addEventListener('change', updateSuggestion));
  async function saveProductCost(productId) {
    const costs = String(form.elements.cost.value || '').split('/').map(v => Number(v.replace(/[^0-9.]/g, ''))).filter(v => v > 0);
    if (!costs.length || !costsReady || !productId) return '';
    const old = costRows.get(Number(productId));
    try { await upsertCosts([{ product_id: Number(productId), costs, strategy: form.elements.strategy.value, competitor_price: old?.competitor_price ?? null }]); return ' Costo guardado.'; }
    catch (err) { return ' (El costo no se guardó: ' + err.message + ')'; }
  }
  $('#feed-copy').addEventListener('click', async () => {
    const text = $('#feed-link').textContent, b = $('#feed-copy');
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copiado ✓'; setTimeout(() => { b.textContent = 'Copiar enlace'; }, 1500); } catch { prompt('Copia el enlace:', text); }
  });

  $('#sales-period').addEventListener('change', renderSales);
  document.querySelectorAll('[data-sales-metric]').forEach(b => b.addEventListener('click', () => { salesMetric = b.dataset.salesMetric; renderSales(); }));

  if(!base||!key){status(loginStatus,'Falta la configuración de Supabase.','error')}else restore();
})();