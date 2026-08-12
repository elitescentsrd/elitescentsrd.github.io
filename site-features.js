'use strict';
(function(){
  const WA='18094333348';
  const seen=new Set();
  const PRODUCTS=(window.PRODUCTS||[]).filter(function(p){
    const key=[p.page,p.slot,p.name,p.price,p.size].join('|');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });

  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function normalizedGender(v){return v==='hombre'?'hombre':v==='mujer'?'mujer':'unisex';}
  function genderLabel(v){const g=normalizedGender(v);return g==='hombre'?'Hombre':g==='mujer'?'Mujer':'Unisex';}
  function parsePrice(v){const m=String(v||'').match(/[\d,]+/g);if(!m)return null;const nums=m.map(x=>Number(x.replace(/,/g,''))).filter(Number.isFinite);return nums.length?Math.min(...nums):null;}
  function visualFor(p){
    const block=p.page<=9?1:p.page<=18?2:p.page<=27?3:4;
    const start=block===1?1:block===2?10:block===3?19:28;
    const col=p.slot%3;
    const row=Math.floor(p.slot/3);
    const globalRow=(p.page-start)*4+row;
    return {image:'catalogo-'+block+'.webp',position:(col*50)+'% '+(globalRow*2.825)+'%'};
  }
  function whatsapp(name,extra){
    let message='Hola Elite Scents RD, me interesa '+name+'.';
    if(extra)message+='\n'+extra;
    message+='\n¿Está disponible?';
    return 'https://wa.me/'+WA+'?text='+encodeURIComponent(message);
  }
  function brandKey(name){
    const n=norm(name).replace(/^paco rabanne /,'paco ').replace(/^mont blanc /,'montblanc ').replace(/^maison alhambra /,'alhambra ');
    return n.split(/\s+/).slice(0,2).join(' ');
  }

  // ===== Destacados diarios =====
  function drDateKey(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=t=>(parts.find(p=>p.type===t)||{}).value||'';
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function hashSeed(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function rng(seed){return function(){seed+=0x6D2B79F5;let t=seed;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  function shuffled(arr,seed){const out=arr.slice(),r=rng(seed);for(let i=out.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  function eligible(p){return p.page>=2&&!/^set\b/i.test(p.name)&&!/\bkids\b|\bgift set\b/i.test(p.name)&&parsePrice(p.price)!==null;}
  function dailySix(){
    const base=PRODUCTS.filter(eligible);
    const seed=hashSeed(drDateKey());
    const chosen=[];
    const brands={};
    ['hombre','mujer','unisex'].forEach(function(group,gi){
      const pool=shuffled(base.filter(p=>normalizedGender(p.gender)===group),seed+gi*131);
      let added=0;
      for(const p of pool){
        const brand=brandKey(p.name);
        if((brands[brand]||0)>=1)continue;
        chosen.push(p);brands[brand]=(brands[brand]||0)+1;added++;
        if(added===2)break;
      }
    });
    if(chosen.length<6){
      for(const p of shuffled(base,seed+999)){
        if(chosen.includes(p))continue;
        const brand=brandKey(p.name);
        if((brands[brand]||0)>=2)continue;
        chosen.push(p);brands[brand]=(brands[brand]||0)+1;
        if(chosen.length===6)break;
      }
    }
    return shuffled(chosen,seed+77).slice(0,6);
  }
  function featuredCard(p){
    const v=visualFor(p);
    const card=document.createElement('article');card.className='product-card';
    const img=document.createElement('div');img.className='product-img';img.setAttribute('role','img');img.setAttribute('aria-label',p.name);img.style.backgroundImage="url('"+v.image+"')";img.style.backgroundPosition=v.position;img.style.backgroundSize='300% auto';img.style.backgroundRepeat='no-repeat';
    const pill=document.createElement('span');pill.className='pill';pill.textContent='DESTACADO DEL DÍA';
    const title=document.createElement('h3');title.textContent=p.name;
    const price=document.createElement('div');price.className='price';price.textContent=p.price||'';
    const info=document.createElement('p');info.textContent=(p.size?p.size+' · ':'')+genderLabel(p.gender)+' · Pág. '+p.page;
    const link=document.createElement('a');link.className='card-link';link.href=whatsapp(p.name,'Lo vi en los destacados de hoy.');link.target='_blank';link.rel='noopener noreferrer';link.textContent='Pedir por WhatsApp →';
    card.append(img,pill,title,price,info,link);
    return card;
  }
  const featured=document.querySelector('#destacados .products');
  if(featured&&PRODUCTS.length){
    featured.replaceChildren(...dailySix().map(featuredCard));
    const description=document.querySelector('#destacados .section-head p');
    if(description)description.textContent='Seis fragancias seleccionadas para hoy. Cambian automáticamente cada día en República Dominicana.';
  }

  // ===== Recomendador =====
  const OVERRIDES={
    '9 PM EDP Men Afnan':['Dulce','Intenso','Elegante','Árabe'],
    'Acqua di Gio Profondo EDP Men':['Fresco','Elegante','Amaderado'],
    'Ariana Grande Cloud':['Dulce','Elegante'],
    'Lattafa Khamrah':['Dulce','Intenso','Árabe'],
    'Lattafa Khamrah Qahwa':['Dulce','Intenso','Árabe'],
    'Lattafa Ramz Silver':['Dulce','Árabe'],
    'Nautica Voyage':['Fresco'],
    'Rasasi Hawas For Him':['Fresco','Árabe'],
    'Rasasi Hawas Ice':['Fresco','Árabe'],
    'Versace Dylan Blue EDT':['Fresco','Elegante'],
    'Versace Eros Eau de Parfum Men':['Dulce','Elegante','Intenso'],
    'Versace Eros Flame EDP Men':['Dulce','Intenso'],
    'Blue Chanel':['Fresco','Elegante','Amaderado'],
    'YSL Y EDT Men':['Fresco','Elegante'],
    'YSL Libre Le Parfum Women':['Dulce','Elegante']
  };
  function profile(p){
    const styles=new Set(OVERRIDES[p.name]||[]),occasions=new Set(),n=norm(p.name);
    if(/lattafa|afnan|armaf|haramain|zimaya|rasasi|rayhaan|orientica|french avenue|maison alhambra|hayaati|badee|barakkat|bharara|zakat/.test(n))styles.add('Árabe');
    if(/aqua|blue|ocean|ice|voyage|sport|sillage|milestone|limoni|dive|profondo|hawas|luna rossa|light blue|dylan blue|y edt|fresh/.test(n))styles.add('Fresco');
    if(/cloud|candy|sweet|eclaire|khamrah|qahwa|tiramisu|chocolate|caramel|vanille|vanilla|marshmallow|yara|devotion|fantasy|toffee|nebras|bonbon/.test(n))styles.add('Dulce');
    if(/intense|intensely|elixir|extrait|sauvage|asad|oud|aoud|spicebomb|victory|eros flame|extradose|most wanted/.test(n))styles.add('Intenso');
    if(/oud|aoud|wood|sauvage|asad|code|le beau|the one|rare carbon|musamam|spicebomb|explorer|polo green|cedar/.test(n))styles.add('Amaderado');
    if(/armani|dior|sauvage|prada|valentino|versace|ysl|yves saint laurent|chanel|givenchy|jpg|invictus|mont blanc|montblanc|lacoste|lancome|mancera|xerjoff|carolina herrera/.test(n))styles.add('Elegante');
    if(styles.has('Fresco')){occasions.add('Uso diario');occasions.add('Oficina');}
    if(styles.has('Elegante')){occasions.add('Citas');occasions.add('Regalo');}
    if(styles.has('Dulce')){occasions.add('Citas');occasions.add('Noche');}
    if(styles.has('Intenso')){occasions.add('Fiestas');occasions.add('Noche');}
    if(styles.has('Amaderado'))occasions.add('Noche');
    if(!occasions.size)occasions.add('Regalo');
    return {styles,occasions};
  }
  function scoreProduct(p,selected,budget){
    if(!eligible(p))return null;
    const pr=profile(p);let score=0;
    if(selected.persona){
      const wanted=norm(selected.persona);
      const actual=normalizedGender(p.gender);
      if(actual===wanted)score+=7;
      else if(actual==='unisex'&&wanted!=='unisex')score+=3;
      else return null;
    }
    if(selected.estilo)score+=pr.styles.has(selected.estilo)?7:-1;
    if(selected.ocasion)score+=pr.occasions.has(selected.ocasion)?5:-1;
    const price=parsePrice(p.price);
    if(budget){if(price===null||price<budget.min||price>budget.max)return null;score+=4;}
    if(OVERRIDES[p.name])score+=2;
    return {p,pr,score,price};
  }
  function pick(selected,budget){
    const ranked=PRODUCTS.map(p=>scoreProduct(p,selected,budget)).filter(Boolean).sort((a,b)=>b.score-a.score||(a.price||999999)-(b.price||999999));
    const out=[],brands={};
    for(const item of ranked){
      const brand=brandKey(item.p.name);
      if((brands[brand]||0)>=2)continue;
      out.push(item);brands[brand]=(brands[brand]||0)+1;
      if(out.length===5)break;
    }
    return out;
  }
  function recoCard(item,selected){
    const p=item.p,v=visualFor(p);
    const card=document.createElement('article');card.className='reco-card';
    const photo=document.createElement('div');photo.className='reco-photo';photo.setAttribute('role','img');photo.setAttribute('aria-label',p.name);photo.style.backgroundImage="url('"+v.image+"')";photo.style.backgroundPosition=v.position;photo.style.backgroundSize='300% auto';photo.style.backgroundRepeat='no-repeat';
    const meta=document.createElement('div');meta.className='reco-meta';meta.textContent=genderLabel(p.gender)+' · Pág. '+p.page;
    const title=document.createElement('h3');title.textContent=p.name;
    const price=document.createElement('div');price.className='reco-price';price.textContent=p.price||'Precio a confirmar';
    const size=document.createElement('div');size.className='reco-size';size.textContent=p.size||'Tamaño según disponibilidad';
    const matches=[];
    if(selected.estilo&&item.pr.styles.has(selected.estilo))matches.push(selected.estilo);
    if(selected.ocasion&&item.pr.occasions.has(selected.ocasion))matches.push(selected.ocasion);
    const why=document.createElement('div');why.className='reco-why';why.textContent=matches.length?'Coincide con: '+matches.join(' · '):'Opción seleccionada según tus preferencias';
    const link=document.createElement('a');link.className='btn reco-order';link.href=whatsapp(p.name,'Llegué a este perfume usando el recomendador de la página.');link.target='_blank';link.rel='noopener noreferrer';link.textContent='Pedir por WhatsApp';
    card.append(photo,meta,title,price,size,why,link);
    return card;
  }

  const root=document.getElementById('recomendador');
  if(root&&PRODUCTS.length){
    const selected={persona:'',ocasion:'',estilo:'',budget:''};let budget=null;
    const summary=document.getElementById('reco-summary');
    const help=document.getElementById('reco-whatsapp');
    const reset=document.getElementById('reco-reset');
    const results=document.getElementById('reco-results');
    const resultTitle=document.getElementById('reco-result-title');
    function render(){
      const labels=[];
      if(selected.persona)labels.push('Para: '+selected.persona);
      if(selected.ocasion)labels.push('Ocasión: '+selected.ocasion);
      if(selected.estilo)labels.push('Estilo: '+selected.estilo);
      if(selected.budget)labels.push('Presupuesto: '+selected.budget);
      summary.textContent=labels.length?labels.join(' · '):'Elige tus preferencias y te mostramos opciones del catálogo completo.';
      help.href='https://wa.me/'+WA+'?text='+encodeURIComponent('Hola Elite Scents RD, quiero una recomendación de perfume.\n'+labels.join('\n'));
      results.replaceChildren();
      if(!labels.length){results.hidden=true;resultTitle.textContent='';return;}
      const list=pick(selected,budget);
      results.hidden=false;
      resultTitle.textContent=list.length?'Opciones que encajan contigo':'No encontramos una coincidencia exacta';
      if(!list.length){const empty=document.createElement('div');empty.className='reco-empty';empty.textContent='Prueba cambiando una preferencia o ampliando el presupuesto. También puedes pedir ayuda directa por WhatsApp.';results.appendChild(empty);return;}
      const grid=document.createElement('div');grid.className='reco-grid';list.forEach(item=>grid.appendChild(recoCard(item,selected)));results.appendChild(grid);
    }
    root.addEventListener('click',function(event){
      const button=event.target.closest('[data-reco]');if(!button)return;
      const group=button.dataset.group;
      root.querySelectorAll('[data-reco][data-group="'+group+'"]').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
      button.classList.add('selected');button.setAttribute('aria-pressed','true');selected[group]=button.dataset.reco;
      if(group==='budget')budget={min:Number(button.dataset.min||0),max:Number(button.dataset.max||999999)};
      render();
    });
    reset.addEventListener('click',function(){
      Object.keys(selected).forEach(k=>selected[k]='');budget=null;
      root.querySelectorAll('[data-reco]').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
      render();
    });
    render();
  }
})();