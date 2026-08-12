'use strict';
const PRODUCTS=window.PRODUCTS||[];
const grid=document.getElementById('productGrid');
const q=document.getElementById('q');
const count=document.getElementById('count');
const buttons=[...document.querySelectorAll('[data-filter]')];
let active='todos';
const Y_STEP=2.825;
function normalized(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function labelGender(value){return value==='hombre'?'Hombre':value==='mujer'?'Mujer':'Unisex';}
function whatsapp(name){return 'https://wa.me/18094333348?text='+encodeURIComponent(`Hola Elite Scents RD, me interesa ${name}. ¿Está disponible?`);}
function visualFor(p){
  const block=p.page<=9?1:p.page<=18?2:p.page<=27?3:4;
  const start=block===1?1:block===2?10:block===3?19:28;
  const col=p.slot%3;
  const row=Math.floor(p.slot/3);
  const globalRow=(p.page-start)*4+row;
  return {image:`catalogo-${block}.webp`,position:`${col*50}% ${globalRow*Y_STEP}%`};
}
function makeCard(p){
  const article=document.createElement('article');article.className='perfume';
  const photo=document.createElement('div');photo.className='photo';photo.setAttribute('role','img');photo.setAttribute('aria-label',p.name);
  const v=visualFor(p);photo.style.backgroundImage=`url('${v.image}')`;photo.style.backgroundPosition=v.position;
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