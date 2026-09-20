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
  async function api(path, options = {}) {
    const res = await fetch(base + path, { ...options, headers: { ...authHeaders(options.json !== false), ...(options.headers || {}) } });
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
  async function restore() {
    try {
      session = JSON.parse(sessionStorage.getItem(tokenKey));
      if (!session?.access_token) return;
      const user = await api('/auth/v1/user', { method: 'GET' });
      session.user = user;
      if (!(await isAdmin())) throw new Error('Esta cuenta no tiene permisos de administración.');
      showAdmin();
    } catch { sessionStorage.removeItem(tokenKey); session = null; }
  }
  function showAdmin() {
    loginCard.classList.add('hidden'); content.classList.remove('hidden'); logout.classList.remove('hidden');
    loadAll().then(()=>{knownOrderIds=new Set(orders.map(o=>String(o.id)));});
    if(!orderPoll) orderPoll=setInterval(checkNewOrders,30000);
  }
  async function checkNewOrders(){
    if(!session)return;
    try{
      const latest=await api('/rest/v1/orders?select=*&order=created_at.desc&limit=20');
      const fresh=latest.filter(o=>!knownOrderIds.has(String(o.id)));
      latest.forEach(o=>knownOrderIds.add(String(o.id)));
      if(fresh.length){
        orders=latest;renderOrders();
        if('Notification' in window && Notification.permission==='granted'){
          new Notification('Nuevo pedido - Elite Scents RD',{body:(fresh[0].customer_name||'Cliente')+' realizó un pedido.'});
        }
        document.title='('+fresh.length+') Nuevo pedido | Elite Scents RD';
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
      if (!(await isAdmin())) throw new Error('Esta cuenta no tiene permisos de administración.');
      status(loginStatus, ''); showAdmin();
    } catch (err) { sessionStorage.removeItem(tokenKey); session = null; status(loginStatus, err.message, 'error'); }
  });
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
    } catch (err) { status(productStatus, err.message, 'error'); }
  }
  function renderProducts(list = products) {
    productsBody.replaceChildren(...list.slice(0,6).map(p => {
      const tr = document.createElement('tr');
      const img = document.createElement('img'); img.src = p.image_url || '/logo-oficial.webp'; img.alt = '';
      const cells = [document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td')];
      cells[0].append(img); cells[1].textContent = p.name; cells[2].textContent = p.brand || '—'; cells[3].textContent = money(p.price);
      cells[4].textContent = p.active === false ? 'Oculto' : (p.availability || 'disponible');
      const edit = document.createElement('button'); edit.type='button'; edit.className='btn btn-secondary'; edit.textContent='Editar'; edit.addEventListener('click',()=>editProduct(p));
      const del = document.createElement('button'); del.type='button'; del.className='btn btn-secondary'; del.textContent='Eliminar'; del.addEventListener('click',()=>deleteProduct(p));
      cells[5].className='admin-actions'; cells[5].append(edit,del); tr.append(...cells); return tr;
    }));
  }
  function orderWhatsapp(o) {
    const eta=o.estimated_delivery?(' Entrega estimada: '+o.estimated_delivery+'.'):'';
    const text='Hola '+(o.customer_name||'')+', recibimos tu pedido #'+o.id+' en Elite Scents RD.'+eta+'\n\n'+(o.items||'')+'\n\nTotal: '+(o.amount||'Por confirmar');
    return 'https://wa.me/'+String(o.phone||'').replace(/\D/g,'')+'?text='+encodeURIComponent(text);
  }
  function renderOrders() {
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
    for (const name of ['id','name','brand','price','size','gender','availability','sort_order','page','slot','description','image_url']) if (form.elements[name]) form.elements[name].value=p[name]??'';
    form.elements.notes_top.value=(p.notes_top||[]).join(', '); form.elements.notes_heart.value=(p.notes_heart||[]).join(', '); form.elements.notes_base.value=(p.notes_base||[]).join(', ');
    form.elements.gallery_urls.value=(p.gallery_urls||[]).join('\n'); form.elements.active.checked=p.active!==false;
    $('#form-title').textContent='Editar perfume'; $('#cancel-edit').classList.remove('hidden'); form.scrollIntoView({behavior:'smooth'});
  }
  function resetForm() { form.reset(); form.elements.id.value=''; form.elements.active.checked=true; form.elements.sort_order.value=0; $('#form-title').textContent='Agregar perfume'; $('#cancel-edit').classList.add('hidden'); }
  $('#cancel-edit').addEventListener('click', resetForm);
  async function upload(file, prefix) {
    if (file.size > 6 * 1024 * 1024) throw new Error('Cada imagen debe pesar menos de 6 MB.');
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
      const rawPrice=Number(String(fd.get('price')).replace(/[^0-9.]/g,''));
      const payload={name:String(fd.get('name')).trim(),brand:String(fd.get('brand')||'').trim(),price:money(rawPrice),size:String(fd.get('size')||'').trim(),gender:String(fd.get('gender')),availability:String(fd.get('availability')),sort_order:Number(fd.get('sort_order'))||0,page:Number(fd.get('page'))||null,slot:Number(fd.get('slot'))||null,image_url:imageUrl||null,notes_top:normalizeArray(fd.get('notes_top')),notes_heart:normalizeArray(fd.get('notes_heart')),notes_base:normalizeArray(fd.get('notes_base')),gallery_urls:gallery,description:String(fd.get('description')||'').trim(),active:fd.get('active')==='on'};
      if(!payload.name||!Number.isFinite(rawPrice)) throw new Error('Completa el nombre y un precio válido.');
      const path=id?'/rest/v1/products?id=eq.'+encodeURIComponent(id):'/rest/v1/products';
      await api(path,{method:id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      status(productStatus,'Producto guardado.','success'); resetForm(); await loadAll();
    } catch(err){status(productStatus,err.message,'error')}
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
  if(!base||!key){status(loginStatus,'Falta la configuración de Supabase.','error')}else restore();
})();