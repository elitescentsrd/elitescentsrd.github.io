'use strict';
(function(){
const EXTRA_FILES=['catalogo-data-7.js','catalogo-data-8.js','catalogo-data-9.js','catalogo-data-10.js','catalogo-data-11.js','catalogo-data-12.js'];
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});}
async function boot(){
try{for(const src of EXTRA_FILES){await loadScript(src);}}catch(e){console.error('No se pudo cargar una parte del catálogo',e);}
const PRODUCTS=window.PRODUCTS||[];
const grid=document.getElementById('productGrid');
const q=document.getElementById('q');
const count=document.getElementById('count');
const filters=document.querySelector('.filters');
if(filters&&!filters.querySelector('[data-filter="sin-especificar"]')){const b=document.createElement('button');b.type='button';b.dataset.filter='sin-especificar';b.textContent='Sin especificar';filters.appendChild(b);}
const buttons=[...document.querySelectorAll('[data-filter]')];
let active='todos';
const Y_STEP=2.825;
function normalized(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function labelGender(value){if(value==='hombre')return 'Hombre';if(value==='mujer')return 'Mujer';if(value==='unisex')return 'Unisex';return 'Sin especificar';}
function whatsapp(name){const message=`Hola Elite Scents RD, me interesa ${name}. ¿Está disponible?`;return 'https://wa.me/18094333348?text='+encodeURIComponent(message);}
function imageInfo(page){if(page<=9)return {file:'catalogo-1.webp',local:page-1};if(page<=18)return {file:'catalogo-2.webp',local:page-10};if(page<=27)return {file:'catalogo-3.webp',local:page-19};return {file:'catalogo-4.webp',local:page-28};}
function makeCard(p){
const article=document.createElement('article');article.className='perfume';
const photo=document.createElement('div');photo.className='photo';photo.setAttribute('role','img');photo.setAttribute('aria-label',p.name);
const col=p.slot%3;const row=Math.floor(p.slot/3);const info=imageInfo(p.page);const globalRow=info.local*4+row;
photo.style.backgroundImage=`url('${info.file}')`;photo.style.backgroundPosition=`${col*50}% ${globalRow*Y_STEP}%`;
const meta=document.createElement('div');meta.className='meta';const page=document.createElement('span');page.textContent='Pág. '+p.page;const gen=document.createElement('span');gen.textContent=labelGender(p.gender);meta.append(page,gen);
const h3=document.createElement('h3');h3.textContent=p.name;
const price=document.createElement('div');price.className='catalog-price';price.textContent=p.price;
const size=document.createElement('div');size.className='size';size.textContent=p.size||' ';
const a=document.createElement('a');a.href=whatsapp(p.name);a.target='_blank';a.rel='noopener noreferrer';a.textContent='Pedir por WhatsApp';
article.append(photo,meta,h3,price,size,a);return article;}
function render(){if(!grid||!q||!count)return;const term=normalized(q.value.trim());grid.replaceChildren();let n=0;const frag=document.createDocumentFragment();for(const p of PRODUCTS){const searchable=normalized(p.name+' '+p.price+' '+p.size+' pagina '+p.page+' '+labelGender(p.gender));const okCat=active==='todos'||p.gender===active;const okText=!term||searchable.includes(term);if(okCat&&okText){frag.appendChild(makeCard(p));n++;}}grid.appendChild(frag);count.textContent=n===1?'1 perfume':`${n} perfumes`;}
const individual=document.getElementById('catalogo-individual');
if(individual){const eyebrow=individual.querySelector('.eyebrow');const description=individual.querySelector('.section-head p');const notice=individual.querySelector('.catalog-notice');if(eyebrow)eyebrow.textContent='Catálogo completo cargado';if(description)description.textContent='Busca por nombre, precio, página o categoría. El buscador incluye todas las fragancias de las páginas 2 a 36.';if(notice)notice.innerHTML=`<strong>${PRODUCTS.length} productos disponibles en el buscador.</strong> Catálogo individual completado hasta la página 36.`;}
if(q)q.addEventListener('input',render);
buttons.forEach(btn=>btn.addEventListener('click',()=>{buttons.forEach(b=>b.classList.remove('active'));btn.classList.add('active');active=btn.dataset.filter;render();}));
render();
}
boot();
})();