'use strict';
const PRODUCTS=window.PRODUCTS||[];
const grid=document.getElementById('productGrid');
const q=document.getElementById('q');
const count=document.getElementById('count');
const buttons=[...document.querySelectorAll('[data-filter]')];
let active='todos';
const Y_STEP=2.825;
function normalized(value){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function labelGender(value){return value==='hombre'?'Hombre':value==='mujer'?'Mujer':'Unisex';}
function whatsapp(name){const message=`Hola Elite Scents RD, me interesa ${name}. ¿Está disponible?`;return 'https://wa.me/18094333348?text='+encodeURIComponent(message);}
function makeCard(p){
const article=document.createElement('article');article.className='perfume';
const photo=document.createElement('div');photo.className='photo';photo.setAttribute('role','img');photo.setAttribute('aria-label',p.name);
const col=p.slot%3;const row=Math.floor(p.slot/3);const localPage=p.page<=9?p.page-1:p.page-10;const globalRow=localPage*4+row;
photo.style.backgroundImage=`url('${p.page<=9?'catalogo-1.webp':'catalogo-2.webp'}')`;photo.style.backgroundPosition=`${col*50}% ${globalRow*Y_STEP}%`;
const meta=document.createElement('div');meta.className='meta';const page=document.createElement('span');page.textContent='Pág. '+p.page;const gen=document.createElement('span');gen.textContent=labelGender(p.gender);meta.append(page,gen);
const h3=document.createElement('h3');h3.textContent=p.name;const price=document.createElement('div');price.className='catalog-price';price.textContent=p.price;const size=document.createElement('div');size.className='size';size.textContent=p.size||' ';
const a=document.createElement('a');a.href=whatsapp(p.name);a.target='_blank';a.rel='noopener noreferrer';a.textContent='Pedir por WhatsApp';article.append(photo,meta,h3,price,size,a);return article;}
function render(){if(!grid||!q||!count)return;const term=normalized(q.value.trim());grid.replaceChildren();let n=0;const frag=document.createDocumentFragment();for(const p of PRODUCTS){const searchable=normalized(p.name+' '+p.price+' '+p.size+' pagina '+p.page);const okCat=active==='todos'||p.gender===active;const okText=!term||searchable.includes(term);if(okCat&&okText){frag.appendChild(makeCard(p));n++;}}grid.appendChild(frag);count.textContent=n===1?'1 perfume':`${n} perfumes`;}
if(q){q.addEventListener('input',render);}buttons.forEach(btn=>btn.addEventListener('click',()=>{buttons.forEach(b=>b.classList.remove('active'));btn.classList.add('active');active=btn.dataset.filter;render();}));render();