'use strict';
const PRODUCTS=window.PRODUCTS||[];
const grid=document.getElementById('productGrid');
const q=document.getElementById('q');
const count=document.getElementById('count');
const buttons=[...document.querySelectorAll('[data-filter]')];
let active='todos';
const PAGE_ROW_STEP=30.13;

function normalized(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function labelGender(value){return value==='hombre'?'Hombre':value==='mujer'?'Mujer':'Unisex';}
function whatsapp(name){return 'https://wa.me/18094333348?text='+encodeURIComponent(`Hola Elite Scents RD, me interesa ${name}. ¿Está disponible?`);}

function visualFor(p){
  const col=p.slot%3;
  const row=Math.floor(p.slot/3);
  return {
    image:`pages/page-${String(p.page).padStart(2,'0')}.webp`,
    position:`${col*50}% ${(row*PAGE_ROW_STEP).toFixed(2)}%`
  };
}

function makeCard(p){
  const article=document.createElement('article');article.className='perfume';
  const photo=document.createElement('div');photo.className='photo';photo.setAttribute('role','img');photo.setAttribute('aria-label',p.name);
  const v=visualFor(p);
  photo.style.backgroundImage=`url('${v.image}')`;
  photo.style.backgroundPosition=v.position;
  photo.style.backgroundSize='300% auto';
  photo.style.backgroundRepeat='no-repeat';
  photo.style.backgroundColor='#fff';
  const meta=document.createElement('div');meta.className='meta';const page=document.createElement('span');page.textContent='Pág. '+p.page;const gen=document.createElement('span');gen.textContent=labelGender(p.gender);meta.append(page,gen);
  const h3=document.createElement('h3');h3.textContent=p.name;
  const price=document.createElement('div');price.className='price';price.textContent=p.price||'Precio a confirmar';
  const size=document.createElement('div');size.className='size';size.textContent=p.size||' ';
  const a=document.createElement('a');a.href=whatsapp(p.name);a.target='_blank';a.rel='noopener noreferrer';a.textContent='Pedir por WhatsApp';
  article.append(photo,meta,h3,price,size,a);return article;
}

function render(){
  if(!grid||!q||!count)return;
  const term=normalized(q.value.trim());grid.replaceChildren();let n=0;const frag=document.createDocumentFragment();
  for(const p of PRODUCTS){const searchable=normalized(p.name+' '+p.price+' '+p.size+' pagina '+p.page);const category=p.gender==='hombre'||p.gender==='mujer'?p.gender:'unisex';const okCat=active==='todos'||category===active;const okText=!term||searchable.includes(term);if(okCat&&okText){frag.appendChild(makeCard({...p,gender:category}));n++;}}
  grid.appendChild(frag);count.textContent=n===1?'1 producto':`${n} productos`;
}
if(q)q.addEventListener('input',render);
buttons.forEach(btn=>btn.addEventListener('click',()=>{buttons.forEach(b=>b.classList.remove('active'));btn.classList.add('active');active=btn.dataset.filter;render();}));
render();

function cleanDynamicCatalogImage(node){
  const targets=[];
  if(node instanceof Element && node.matches('.product-img,.reco-photo'))targets.push(node);
  if(node instanceof Element)targets.push(...node.querySelectorAll('.product-img,.reco-photo'));
  for(const el of targets){
    if(!String(el.style.backgroundImage||'').includes('pages/page-'))continue;
    const parts=String(el.style.backgroundPosition||'0% 0%').trim().split(/\s+/);
    const x=parts[0]||'0%';
    const oldY=Number.parseFloat(parts[1]||'0')||0;
    const row=Math.max(0,Math.min(3,Math.round(oldY/(100/3))));
    el.style.backgroundSize='300% auto';
    el.style.backgroundPosition=`${x} ${(row*PAGE_ROW_STEP).toFixed(2)}%`;
    el.style.backgroundRepeat='no-repeat';
    el.style.backgroundColor='#fff';
  }
}

if(document.body){
  document.querySelectorAll('.product-img,.reco-photo').forEach(cleanDynamicCatalogImage);
  const visualObserver=new MutationObserver(mutations=>{
    for(const mutation of mutations)for(const node of mutation.addedNodes)cleanDynamicCatalogImage(node);
  });
  visualObserver.observe(document.body,{childList:true,subtree:true});
}

const logoStyle=document.createElement('style');
logoStyle.textContent=`
  .nav .brand img{width:56px!important;height:56px!important;object-fit:contain!important;border-radius:10px!important;background:#080808}
  .nav .nav-inner{min-height:84px}
  .hero-logo{width:104px!important;height:104px!important;object-fit:contain!important;border-radius:14px!important;background:#080808}
  .footer img{width:76px!important;height:76px!important;object-fit:contain!important;border-radius:12px!important;background:#080808}
  @media(max-width:600px){
    .nav .brand img{width:44px!important;height:44px!important}
    .nav .nav-inner{min-height:68px}
    .hero-logo{width:82px!important;height:82px!important}
  }
`;
document.head.appendChild(logoStyle);

// Use a new asset URL so browsers do not keep showing an older cached logo.
document.querySelectorAll('img[src*="logo.webp"]').forEach(img=>{img.src='logo-oficial.webp?v=1';});
const favicon=document.querySelector('link[rel="icon"]');
if(favicon){favicon.href='logo-oficial.webp?v=1';favicon.type='image/webp';}
const appleIcon=document.querySelector('link[rel="apple-touch-icon"]');
if(appleIcon)appleIcon.href='logo-oficial.webp?v=1';
