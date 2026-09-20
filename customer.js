'use strict';
(()=>{
const cfg=window.ELITE_SUPABASE||{},base=String(cfg.url||'').replace(/\/$/,''),key=cfg.publishableKey||'';
const WA='18094333348',CART_KEY='elite-scents-cart-v3',SESSION_KEY='elite-customer-session-v1';
const $=(s)=>document.querySelector(s);
let mode='login',session=readSession(),mfaEnrollment=null;

function money(n){return 'RD$'+new Intl.NumberFormat('es-DO').format(Number(n)||0)}
function parsePrices(value){return (String(value).match(/[0-9][0-9,.]*/g)||[]).map(v=>Number(v.replace(/[,.]/g,''))).filter(Number.isFinite)}
function readCart(){try{const v=JSON.parse(localStorage.getItem(CART_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function saveCart(items){localStorage.setItem(CART_KEY,JSON.stringify(items));renderCart()}
function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function saveSession(v){session=v;v?localStorage.setItem(SESSION_KEY,JSON.stringify(v)):localStorage.removeItem(SESSION_KEY)}
async function json(res){const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!res.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||('Error '+res.status));return data}
async function authFetch(path,options={}){if(!session?.access_token)throw new Error('Inicia sesión.');const res=await fetch(base+path,{...options,headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',...(options.headers||{})}});if(res.status===401&&session?.refresh_token){await refreshSession();return authFetch(path,options)}return json(res)}
async function refreshSession(){const res=await fetch(base+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});const data=await json(res);saveSession({...data,user:data.user||session.user});return session}
function selectedPrice(item){return Number(item.unit_price)||parsePrices(item.price)[0]||0}
function cartTotal(){return readCart().reduce((sum,item)=>sum+selectedPrice(item)*(Number(item.qty)||1),0)}
function renderCart(){
 const root=$('#cartItems'),items=readCart();root.replaceChildren();
 $('#cartEmpty').hidden=items.length>0;$('#cartTotal').textContent=money(cartTotal());
 for(const item of items){
   const row=document.createElement('div');row.className='cart-row';
   const info=document.createElement('div'),h=document.createElement('h3'),p=document.createElement('p'),price=document.createElement('p');
   h.textContent=item.name;p.textContent=[item.brand,item.size].filter(Boolean).join(' · ');price.textContent=money(selectedPrice(item))+' c/u';
   info.append(h,p,price);
   const actions=document.createElement('div');actions.className='cart-row-actions';
   const qty=document.createElement('input');qty.className='qty';qty.type='number';qty.min='1';qty.max='10';qty.value=Number(item.qty)||1;qty.setAttribute('aria-label','Cantidad de '+item.name);
   qty.addEventListener('change',()=>{const next=readCart(),found=next.find(x=>String(x.key)===String(item.key));if(found){found.qty=Math.max(1,Math.min(10,Number(qty.value)||1));saveCart(next)}});
   const del=document.createElement('button');del.type='button';del.className='button outline';del.textContent='Quitar';del.addEventListener('click',()=>saveCart(readCart().filter(x=>String(x.key)!==String(item.key))));
   actions.append(qty,del);row.append(info,actions);root.append(row);
 }
 const lines=items.map(i=>(Number(i.qty)||1)+'× '+i.name+' · '+(i.size||'')+' · '+money(selectedPrice(i)));
 const msg='Hola Elite Scents RD, quiero consultar este carrito:\n\n'+lines.join('\n')+'\n\nTotal estimado: '+money(cartTotal())+'\n¿Me confirmas disponibilidad y tiempo de entrega?';
 $('#cartWhatsapp').href='https://wa.me/'+WA+'?text='+encodeURIComponent(msg);
 $('#cartWhatsapp').classList.toggle('hidden',!items.length);
 $('#clearCart').disabled=!items.length;
}
function setMode(next,keepStatus){mode=next;$('#loginTab').classList.toggle('active',mode==='login');$('#signupTab').classList.toggle('active',mode==='signup');$('#authTitle').textContent=mode==='login'?'Iniciar sesión':'Crear cuenta';$('#authSubmit').textContent=mode==='login'?'Entrar':'Crear cuenta';const pass=$('#authForm').elements.password;pass.autocomplete=mode==='login'?'current-password':'new-password';if(!keepStatus)$('#authStatus').textContent=''}
// Verificación en dos pasos al entrar: si la cuenta tiene un factor TOTP verificado, tras la contraseña se pide el código.
let mfaPending=null;
async function verifiedTotp(data){
 let user=data.user;
 if(!user||!Array.isArray(user.factors)){const res=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+data.access_token}});user=await json(res)}
 return (user.factors||[]).find(f=>f.factor_type==='totp'&&f.status==='verified')||null;
}
async function login(email,password){
 const res=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 const data=await json(res);
 const factor=await verifiedTotp(data);
 if(factor){mfaPending={session:data,factorId:factor.id};$('#authForm').classList.add('hidden');$('#mfaLoginForm').classList.remove('hidden');$('#mfaLoginStatus').textContent='';$('#mfaLoginForm [name=code]').value='';$('#mfaLoginForm [name=code]').focus();return}
 saveSession(data);await afterLogin();
}
async function finishMfaLogin(code){
 if(!mfaPending)throw new Error('Vuelve a iniciar sesión.');
 if(!/^\d{6,8}$/.test(code))throw new Error('Escribe el código de 6 dígitos de tu app.');
 const headers={apikey:key,Authorization:'Bearer '+mfaPending.session.access_token,'Content-Type':'application/json'},id=encodeURIComponent(mfaPending.factorId);
 const challenge=await json(await fetch(base+'/auth/v1/factors/'+id+'/challenge',{method:'POST',headers,body:'{}'}));
 const verified=await json(await fetch(base+'/auth/v1/factors/'+id+'/verify',{method:'POST',headers,body:JSON.stringify({challenge_id:challenge.id,code})}));
 saveSession({...verified,user:verified.user||mfaPending.session.user});mfaPending=null;
 $('#mfaLoginForm').classList.add('hidden');$('#authForm').classList.remove('hidden');
 await afterLogin();
}
// El enlace del correo de confirmación vuelve a esta misma página (debe estar en la lista de URLs permitidas de Supabase Auth).
const SITE_URL='https://elitescentsrd.github.io';
function redirectUrl(){return (location.protocol==='https:'?location.origin:SITE_URL)+'/checkout.html'}
function friendly(message){
 const m=String(message||'');
 if(/email not confirmed/i.test(m))return 'Tu correo todavía no está confirmado. Abre el enlace que te enviamos (revisa también spam) o reenvía el correo.';
 if(/invalid login credentials/i.test(m))return 'Correo o contraseña incorrectos.';
 if(/already registered/i.test(m))return 'Ese correo ya tiene una cuenta. Inicia sesión.';
 if(/rate limit|too many/i.test(m))return 'Se hicieron demasiados intentos o correos. Espera unos minutos e inténtalo otra vez.';
 if(/invalid totp|mfa verification|verification failed/i.test(m))return 'Código incorrecto o vencido. Escribe el código actual que muestra tu app (cambia cada 30 segundos).';
 if(/aal2/i.test(m))return 'Para este cambio inicia sesión de nuevo con tu código de verificación y vuelve a intentarlo.';
 if(/friendly name|already exists/i.test(m))return 'Ya había una configuración a medias. Pulsa "Activar MFA" otra vez.';
 if(/password should be at least|weak/i.test(m))return 'La contraseña es demasiado débil: usa al menos 8 caracteres.';
 return m;
}
let pendingEmail='';
function offerResend(email){pendingEmail=email;$('#resendConfirm').classList.remove('hidden')}
async function resendConfirmation(){
 if(!pendingEmail)return;$('#authStatus').textContent='Reenviando…';
 const res=await fetch(base+'/auth/v1/resend?redirect_to='+encodeURIComponent(redirectUrl()),{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({type:'signup',email:pendingEmail})});
 await json(res);$('#authStatus').textContent='Te enviamos otro correo a '+pendingEmail+'. Abre el enlace más reciente.';
}
async function signup(email,password){const res=await fetch(base+'/auth/v1/signup?redirect_to='+encodeURIComponent(redirectUrl()),{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});const data=await json(res);if(data.access_token){saveSession(data);await afterLogin()}else{$('#authStatus').textContent='Cuenta creada. Te enviamos un correo a '+email+': abre el enlace para confirmarla y volverás a esta página para completar tu pedido.';offerResend(email);setMode('login',true)}}
// Al volver del enlace del correo, Supabase añade la sesión (o un error) en el fragmento # de la URL.
async function handleAuthRedirect(){
 const hash=location.hash.replace(/^#/,'');if(!hash)return false;
 const q=new URLSearchParams(hash);
 if(q.get('error')||q.get('error_code')){
  history.replaceState(null,'',location.pathname+location.search);
  $('#authStatus').textContent=q.get('error_code')==='otp_expired'?'El enlace ya se usó o expiró. Inicia sesión con tu correo y contraseña; si aún no puedes, pide otro correo de confirmación.':friendly(q.get('error_description')||'No se pudo confirmar el correo.');
  return true;
 }
 if(q.get('access_token')){
  saveSession({access_token:q.get('access_token'),refresh_token:q.get('refresh_token'),expires_in:Number(q.get('expires_in'))||3600,token_type:q.get('token_type')||'bearer'});
  history.replaceState(null,'',location.pathname+location.search);
  await afterLogin();
  if(q.get('type')==='signup'||q.get('type')==='email')$('#profileStatus').textContent='Correo confirmado. Completa tus datos y pulsa "Pedir / Ordenar carrito".';
  return true;
 }
 return false;
}
async function afterLogin(){
 $('#authArea').classList.add('hidden');$('#customerArea').classList.remove('hidden');
 try{const user=await authFetch('/auth/v1/user',{method:'GET'});session.user=user;saveSession(session);await loadProfile();renderMfaState(user);await loadOrders()}catch(err){$('#profileStatus').textContent=err.message}
}
async function loadProfile(){
 const uid=session?.user?.id;if(!uid)return;
 const res=await authFetch('/rest/v1/customer_profiles?select=*&user_id=eq.'+encodeURIComponent(uid),{method:'GET'});
 const p=Array.isArray(res)?res[0]:null;if(!p)return;
 for(const name of ['first_name','last_name','cedula','phone','address'])if($('#profileForm').elements[name])$('#profileForm').elements[name].value=p[name]||'';
}
async function saveProfile(fd){
 const uid=session.user.id,payload={user_id:uid,first_name:String(fd.get('first_name')).trim(),last_name:String(fd.get('last_name')).trim(),cedula:String(fd.get('cedula')||'').trim(),phone:String(fd.get('phone')).trim(),address:String(fd.get('address')).trim(),updated_at:new Date().toISOString()};
 const existing=await authFetch('/rest/v1/customer_profiles?select=user_id&user_id=eq.'+encodeURIComponent(uid),{method:'GET'});
 const path='/rest/v1/customer_profiles'+(Array.isArray(existing)&&existing.length?'?user_id=eq.'+encodeURIComponent(uid):'');
 await authFetch(path,{method:Array.isArray(existing)&&existing.length?'PATCH':'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)});
}
function renderMfaState(user){
 const verified=(user?.factors||[]).some(f=>f.factor_type==='totp'&&f.status==='verified');
 $('#mfaInactive').classList.toggle('hidden',verified);$('#mfaActive').classList.toggle('hidden',!verified);$('#mfaSetup').classList.add('hidden');$('#mfaStatus').textContent=verified?'MFA activado en esta cuenta: al entrar se pedirá el código de tu app.':'MFA opcional: todavía no está activado.';
}
// Supabase entrega el QR como un SVG (a veces ya dentro de una URL data: sin codificar); se normaliza para que el <img> lo dibuje.
function qrSource(qr){
 const s=String(qr||'');const i=s.indexOf('<svg');
 if(i>=0)return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s.slice(i));
 return /^data:image\//i.test(s)?s:'';
}
async function enableMfa(){
 $('#mfaStatus').textContent='Preparando MFA…';
 // Un intento anterior sin terminar deja un factor "unverified" que bloquea uno nuevo: se elimina antes.
 const current=await authFetch('/auth/v1/user',{method:'GET'});
 for(const f of (current.factors||[]))if(f.factor_type==='totp'&&f.status!=='verified')await authFetch('/auth/v1/factors/'+encodeURIComponent(f.id),{method:'DELETE'}).catch(()=>{});
 const data=await authFetch('/auth/v1/factors',{method:'POST',body:JSON.stringify({factor_type:'totp',friendly_name:'Elite Scents '+Date.now().toString(36)})});
 mfaEnrollment=data;
 const img=$('#mfaQr'),src=qrSource(data?.totp?.qr_code);
 img.classList.toggle('hidden',!src);if(src)img.src=src;
 img.onerror=()=>{img.classList.add('hidden');$('#mfaStatus').textContent='No se pudo dibujar el QR. Usa el botón "Abrir en mi app" o escribe la clave manual en tu app.'};
 const uri=String(data?.totp?.uri||''),link=$('#mfaLink');
 if(/^otpauth:\/\//i.test(uri)){link.href=uri;link.classList.remove('hidden')}else link.classList.add('hidden');
 $('#mfaSecret').textContent=data?.totp?.secret||'';$('#mfaCode').value='';$('#mfaSetup').classList.remove('hidden');$('#mfaInactive').classList.add('hidden');$('#mfaStatus').textContent='Escanea el QR (o usa la clave manual) y escribe el código de tu app.';
}
async function disableMfa(){
 const factor=(session?.user?.factors||[]).find(f=>f.factor_type==='totp'&&f.status==='verified');
 if(!factor)return;if(!confirm('¿Desactivar la verificación en dos pasos de esta cuenta?'))return;
 await authFetch('/auth/v1/factors/'+encodeURIComponent(factor.id),{method:'DELETE'});
 const user=await authFetch('/auth/v1/user',{method:'GET'});session.user=user;saveSession(session);renderMfaState(user);$('#mfaStatus').textContent='MFA desactivado.';
}
async function verifyMfa(){
 if(!mfaEnrollment?.id)throw new Error('Primero inicia la configuración MFA.');
 const code=$('#mfaCode').value.trim();if(!/^\d{6,8}$/.test(code))throw new Error('Escribe el código de tu aplicación.');
 const challenge=await authFetch('/auth/v1/factors/'+encodeURIComponent(mfaEnrollment.id)+'/challenge',{method:'POST',body:JSON.stringify({factorId:mfaEnrollment.id})});
 const verified=await authFetch('/auth/v1/factors/'+encodeURIComponent(mfaEnrollment.id)+'/verify',{method:'POST',body:JSON.stringify({challenge_id:challenge.id,code})});
 if(verified?.access_token)saveSession({...verified,user:session.user});
 const user=await authFetch('/auth/v1/user',{method:'GET'});session.user=user;saveSession(session);renderMfaState(user);$('#mfaStatus').textContent='MFA activado correctamente.';
}
async function placeOrder(){
 const items=readCart();if(!items.length)throw new Error('Tu carrito está vacío.');
 $('#orderStatus').textContent='Registrando pedido…';
 const payload=items.map(i=>({product_id:Number(i.product_id),qty:Number(i.qty)||1,unit_price:selectedPrice(i),size:i.size||''}));
 const data=await authFetch('/rest/v1/rpc/place_customer_order',{method:'POST',body:JSON.stringify({p_items:payload})});
 const status=$('#orderStatus');
 status.textContent='Pedido #'+data.order_id+' recibido. Te contactaremos por WhatsApp para confirmar disponibilidad y el tiempo estimado de entrega. Para avisarnos de inmediato, envíanos tu pedido por WhatsApp:';
 // Aviso inmediato a la tienda: el cliente abre WhatsApp con el pedido ya escrito y solo pulsa enviar.
 const lines=items.map(i=>(Number(i.qty)||1)+'× '+i.name+(i.size?' · '+i.size:'')+' · '+money(selectedPrice(i)));
 const total=items.reduce((sum,i)=>sum+selectedPrice(i)*(Number(i.qty)||1),0);
 const link=document.createElement('a');link.className='button gold';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Enviar mi pedido #'+data.order_id+' por WhatsApp ↗';
 link.href='https://wa.me/'+WA+'?text='+encodeURIComponent('Hola Elite Scents RD, acabo de hacer el pedido #'+data.order_id+' en la web:\n\n'+lines.join('\n')+'\n\nTotal estimado: '+money(total)+'\nQuedo atento(a) a la confirmación.');
 status.append(document.createElement('br'),link);
 saveCart([]);await loadOrders();
}
async function loadOrders(){
 if(!session?.user?.id)return;
 try{
  const rows=await authFetch('/rest/v1/orders?select=id,created_at,status,items,amount,estimated_delivery&user_id=eq.'+encodeURIComponent(session.user.id)+'&order=created_at.desc',{method:'GET'});
  const root=$('#myOrders');root.replaceChildren();
  if(!rows.length){root.innerHTML='<p class="muted">Todavía no tienes pedidos.</p>';return}
  rows.forEach(o=>{const card=document.createElement('article');card.className='order-card';const h=document.createElement('strong');h.textContent='Pedido #'+o.id+' · '+String(o.status||'nuevo').toUpperCase();const date=document.createElement('p');date.textContent=new Date(o.created_at).toLocaleString('es-DO');const items=document.createElement('p');items.textContent=o.items;const total=document.createElement('p');total.textContent='Total: '+(o.amount||'Por confirmar');const eta=document.createElement('p');eta.textContent=o.estimated_delivery?'Entrega estimada: '+o.estimated_delivery:'Tiempo de entrega: pendiente de confirmación';card.append(h,date,items,total,eta);root.append(card)});
 }catch(err){$('#myOrders').textContent=err.message}
}
$('#loginTab').addEventListener('click',()=>setMode('login'));$('#signupTab').addEventListener('click',()=>setMode('signup'));
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),email=String(fd.get('email')).trim(),password=String(fd.get('password'));$('#authStatus').textContent='Procesando…';try{mode==='login'?await login(email,password):await signup(email,password)}catch(err){$('#authStatus').textContent=friendly(err.message);if(/email not confirmed/i.test(err.message))offerResend(email)}});
$('#resendConfirm').addEventListener('click',()=>resendConfirmation().catch(err=>$('#authStatus').textContent=friendly(err.message)));
$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();$('#profileStatus').textContent='Guardando…';try{await saveProfile(new FormData(e.currentTarget));$('#profileStatus').textContent='Datos guardados.'}catch(err){$('#profileStatus').textContent=err.message}});
$('#signOut').addEventListener('click',()=>{saveSession(null);location.reload()});
$('#enableMfa').addEventListener('click',()=>enableMfa().catch(err=>{$('#mfaStatus').textContent=friendly(err.message);$('#mfaInactive').classList.remove('hidden')}));
$('#verifyMfa').addEventListener('click',()=>verifyMfa().catch(err=>$('#mfaStatus').textContent=friendly(err.message)));
$('#disableMfa').addEventListener('click',()=>disableMfa().catch(err=>$('#mfaStatus').textContent=friendly(err.message)));
$('#mfaLoginForm').addEventListener('submit',async e=>{e.preventDefault();$('#mfaLoginStatus').textContent='Verificando…';try{await finishMfaLogin(String(new FormData(e.currentTarget).get('code')).trim())}catch(err){$('#mfaLoginStatus').textContent=friendly(err.message)}});
$('#mfaLoginCancel').addEventListener('click',()=>{mfaPending=null;$('#mfaLoginForm').classList.add('hidden');$('#authForm').classList.remove('hidden');$('#authStatus').textContent='';$('#authForm').elements.password.value=''});
$('#placeOrder').addEventListener('click',async()=>{
 const profile=$('#profileForm');
 if(!profile.reportValidity())return;
 try{await saveProfile(new FormData(profile));await placeOrder()}catch(err){$('#orderStatus').textContent=err.message}
});
$('#clearCart').addEventListener('click',()=>{if(confirm('¿Vaciar el carrito?'))saveCart([])});
renderCart();setMode('login');
handleAuthRedirect().then(handled=>{if(!handled&&session?.access_token)afterLogin()}).catch(err=>{$('#authStatus').textContent=friendly(err.message)});
})();