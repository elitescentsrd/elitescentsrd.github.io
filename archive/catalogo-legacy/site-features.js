'use strict';
(function(){
  const WA='18094333348';
  const seen=new Set();
  const compactStyle=document.createElement('style');
  compactStyle.textContent=`
    #destacados .products{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;max-width:1040px;margin:0 auto}
    #destacados .product-card{border-radius:20px;padding:12px 12px 16px;box-shadow:0 10px 28px rgba(11,10,10,.08);min-width:0}
    #destacados .product-img{width:100%;height:auto;aspect-ratio:4/3;border-radius:14px;margin-bottom:12px;border:1px solid #f0e5cc}
    #destacados .pill{padding:5px 9px;font-size:9px;letter-spacing:.08em}
    #destacados .product-card h3{font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.25;margin:9px 0 5px;min-height:43px}
    #destacados .price{font-size:23px;min-height:32px}
    #destacados .product-card p{font-size:11px;margin:3px 0 9px}
    #destacados .card-link{font-size:12px}
    #recomendador .reco-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;max-width:980px;margin:0 auto}
    #recomendador .reco-card{border-radius:18px;padding:11px;box-shadow:0 8px 22px rgba(0,0,0,.06);min-width:0}
    #recomendador .reco-photo{aspect-ratio:4/3;border-radius:12px}
    #recomendador .reco-card h3{font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.25;margin:7px 0;min-height:38px}
    #recomendador .reco-price{font-size:18px}
    #recomendador .reco-size,#recomendador .reco-why{font-size:11px;line-height:1.35}
    #recomendador .reco-order{padding:9px 11px;font-size:11px;margin-top:10px}
    .reco-more-wrap{text-align:center;margin-top:18px}.reco-more{padding:11px 18px;font-size:13px}
    .catalog-grid .photo{aspect-ratio:4/3;border-radius:14px}
    .catalog-grid .perfume h3{font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.25}
    @media(max-width:900px){#destacados .products,#recomendador .reco-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:600px){#destacados .products,#recomendador .reco-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(compactStyle);

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
    const col=p.slot%3;
    const row=Math.floor(p.slot/3);
    return {
      image:'pages/page-'+String(p.page).padStart(2,'0')+'.webp',
      position:(col*50)+'% '+(row*(100/3))+'%'
    };
  }
  function applyProductBackground(el,p){
    const v=visualFor(p);
    el.style.backgroundImage="url('"+v.image+"')";
    el.style.backgroundPosition=v.position;
    el.style.backgroundSize='300% 400%';
    el.style.backgroundRepeat='no-repeat';
  }
  function whatsapp(name,extra){
    let message='Hola Elite Scents RD, me interesa '+name+'.';
    if(extra)message+='\n'+extra;
    message+='\n¿Está disponible?';
    return 'https://wa.me/'+WA+'?text='+encodeURIComponent(message);
  }
  const BRAND_PATTERNS=[
    ['jean paul gaultier',/^(jpg|jean paul gaultier)\b/],['paco rabanne',/^(paco rabanne|rabanne)\b/],['dolce & gabbana',/^(dolce|d&g)\b/],['carolina herrera',/^(carolina herrera|212)\b/],['calvin klein',/^(calvin klein|ck)\b/],['al haramain',/^al haramain\b/],['maison alhambra',/^maison alhambra\b/],['french avenue',/^french avenue\b/],['bond no.9',/^bond\b/],['issey miyake',/^issey miyake\b/],['ariana grande',/^ariana grande\b/],['britney spears',/^britney spears\b/],['ralph lauren',/^(ralph lauren|polo)\b/],['victorias secret',/^victoria/],['montblanc',/^(montblanc|mont blanc)\b/],['giorgio armani',/^(armani|acqua di gio)\b/],['yves saint laurent',/^(ysl|yves saint laurent)\b/]
  ];
  function brandKey(name){
    const n=norm(name);
    for(const [brand,re] of BRAND_PATTERNS)if(re.test(n))return brand;
    return n.split(/\s+/)[0]||'otro';
  }
  function hashSeed(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function rng(seed){return function(){seed+=0x6D2B79F5;let t=seed;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  function shuffled(arr,seed){const out=arr.slice(),r=rng(seed);for(let i=out.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  function eligible(p){return p.page>=2&&!/^set\b/i.test(p.name)&&!/\bkids\b|\bgift set\b/i.test(p.name)&&parsePrice(p.price)!==null;}

  function drDateKey(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=t=>(parts.find(p=>p.type===t)||{}).value||'';
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function dailySix(){
    const base=PRODUCTS.filter(eligible);
    const seed=hashSeed(drDateKey());
    const chosen=[],brands={};
    ['hombre','mujer','unisex'].forEach(function(group,gi){
      const pool=shuffled(base.filter(p=>normalizedGender(p.gender)===group),seed+gi*131);
      let added=0;
      for(const p of pool){
        const brand=brandKey(p.name);
        if(brands[brand])continue;
        chosen.push(p);brands[brand]=1;added++;
        if(added===2)break;
      }
    });
    for(const p of shuffled(base,seed+999)){
      if(chosen.length>=6)break;
      if(chosen.includes(p))continue;
      const brand=brandKey(p.name);
      if(brands[brand])continue;
      chosen.push(p);brands[brand]=1;
    }
    return shuffled(chosen,seed+77).slice(0,6);
  }
  function featuredCard(p){
    const card=document.createElement('article');card.className='product-card';
    const img=document.createElement('div');img.className='product-img';img.setAttribute('role','img');img.setAttribute('aria-label',p.name);applyProductBackground(img,p);
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
    if(description)description.textContent='Seis fragancias diferentes seleccionadas para hoy. Cambian automáticamente cada día en República Dominicana.';
  }

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
    if(/lattafa|afnan|armaf|haramain|zimaya|rasasi|rayhaan|orientica|french avenue|maison alhambra|hayaati|badee|barakkat|bharara|zakat|dumont|emir|paris corner/.test(n))styles.add('Árabe');
    if(/aqua|blue|bleu|ocean|ice|voyage|sport|sillage|milestone|limoni|dive|profondo|hawas|luna rossa|light blue|dylan blue|y edt|fresh|cool water|chrome|marine|paradise garden|beach|wave|sky|azure/.test(n))styles.add('Fresco');
    if(/cloud|candy|sweet|eclaire|khamrah|qahwa|tiramisu|chocolate|caramel|vanille|vanilla|marshmallow|yara|devotion|fantasy|toffee|nebras|bonbon|scandal|stronger with you|9 pm|eros|million|cookie|mallow|pistache|banoffi|gourmand/.test(n))styles.add('Dulce');
    if(/intense|intensely|elixir|extrait|sauvage|asad|oud|aoud|spicebomb|victory|eros flame|extradose|most wanted|le parfum|parfum|ultra male|black/.test(n))styles.add('Intenso');
    if(/oud|aoud|wood|sauvage|asad|code|le beau|the one|rare carbon|musamam|spicebomb|explorer|polo green|cedar|leather|tobacco|vetiver|bois/.test(n))styles.add('Amaderado');
    if(/armani|dior|sauvage|prada|valentino|versace|ysl|yves saint laurent|chanel|givenchy|jpg|invictus|mont blanc|montblanc|lacoste|lancome|mancera|xerjoff|carolina herrera|coach|burberry|gucci|dolce|rabanne|azzaro|boss|ralph lauren|issey miyake|narciso|elie saab/.test(n))styles.add('Elegante');
    if(styles.has('Fresco')){occasions.add('Uso diario');occasions.add('Oficina');occasions.add('Regalo');}
    if(styles.has('Elegante')){occasions.add('Oficina');occasions.add('Citas');occasions.add('Regalo');}
    if(styles.has('Dulce')){occasions.add('Citas');occasions.add('Noche');occasions.add('Regalo');}
    if(styles.has('Intenso')){occasions.add('Fiestas');occasions.add('Noche');}
    if(styles.has('Amaderado')){occasions.add('Citas');occasions.add('Noche');}
    if(styles.has('Árabe')&&!occasions.size){occasions.add('Uso diario');occasions.add('Regalo');}
    if(!occasions.size){occasions.add('Uso diario');occasions.add('Regalo');}
    return {styles,occasions};
  }
  function selectionKey(selected,budget){return [selected.persona,selected.ocasion,selected.estilo,selected.budget,budget?budget.min:'',budget?budget.max:''].join('|');}
  function scoreProduct(p,selected,budget,key){
    if(!eligible(p))return null;
    const pr=profile(p);let score=0;
    if(selected.persona){
      const wanted=norm(selected.persona),actual=normalizedGender(p.gender);
      if(actual===wanted)score+=9;
      else if(actual==='unisex'&&wanted!=='unisex')score+=3;
      else return null;
    }
    if(selected.estilo)score+=pr.styles.has(selected.estilo)?10:-7;
    if(selected.ocasion)score+=pr.occasions.has(selected.ocasion)?7:-4;
    const price=parsePrice(p.price);
    if(budget){if(price===null||price<budget.min||price>budget.max)return null;score+=6;}
    if(OVERRIDES[p.name])score+=2;
    const jitter=(hashSeed(p.name+'|'+key)%1000)/1000;
    score+=jitter;
    return {p,pr,score,price};
  }
  function rankedCandidates(selected,budget){
    const key=selectionKey(selected,budget);
    let ranked=PRODUCTS.map(p=>scoreProduct(p,selected,budget,key)).filter(Boolean).sort((a,b)=>b.score-a.score||(a.price||999999)-(b.price||999999));
    const exact=ranked.filter(item=>(!selected.estilo||item.pr.styles.has(selected.estilo))&&(!selected.ocasion||item.pr.occasions.has(selected.ocasion)));
    if(exact.length>=12)ranked=exact;
    return ranked;
  }
  function pickSix(ranked,cycle,avoid){
    if(!ranked.length)return [];
    const rotated=ranked.slice((cycle*6)%ranked.length).concat(ranked.slice(0,(cycle*6)%ranked.length));
    const out=[],brands={},bands={};
    function tryAdd(item,relaxed){
      const p=item.p,brand=brandKey(p.name),band=Math.floor((p.page-2)/6);
      if(out.some(x=>x.p.name===p.name))return false;
      if(!relaxed&&avoid&&avoid.has(p.name))return false;
      if(!relaxed&&(brands[brand]||0)>=1)return false;
      if(!relaxed&&(bands[band]||0)>=2)return false;
      if(relaxed&&(brands[brand]||0)>=2)return false;
      out.push(item);brands[brand]=(brands[brand]||0)+1;bands[band]=(bands[band]||0)+1;return true;
    }
    for(const item of rotated){tryAdd(item,false);if(out.length===6)break;}
    if(out.length<6)for(const item of rotated){tryAdd(item,true);if(out.length===6)break;}
    return out;
  }
  function recoCard(item,selected){
    const p=item.p;
    const card=document.createElement('article');card.className='reco-card';
    const photo=document.createElement('div');photo.className='reco-photo';photo.setAttribute('role','img');photo.setAttribute('aria-label',p.name);applyProductBackground(photo,p);
    const meta=document.createElement('div');meta.className='reco-meta';meta.textContent=genderLabel(p.gender)+' · Pág. '+p.page;
    const title=document.createElement('h3');title.textContent=p.name;
    const price=document.createElement('div');price.className='reco-price';price.textContent=p.price||'Precio a confirmar';
    const size=document.createElement('div');size.className='reco-size';size.textContent=p.size||'Tamaño según disponibilidad';
    const matches=[];
    if(selected.estilo&&item.pr.styles.has(selected.estilo))matches.push(selected.estilo);
    if(selected.ocasion&&item.pr.occasions.has(selected.ocasion))matches.push(selected.ocasion);
    const why=document.createElement('div');why.className='reco-why';why.textContent=matches.length?'Coincide con: '+matches.join(' · '):'Opción variada del catálogo según tus preferencias';
    const link=document.createElement('a');link.className='btn reco-order';link.href=whatsapp(p.name,'Llegué a este perfume usando el recomendador de la página.');link.target='_blank';link.rel='noopener noreferrer';link.textContent='Pedir por WhatsApp';
    card.append(photo,meta,title,price,size,why,link);
    return card;
  }

  const root=document.getElementById('recomendador');
  if(root){const intro=root.querySelector('.section-head p');if(intro)intro.textContent='Cuéntanos qué buscas. El motor recorre los '+PRODUCTS.length+' productos cargados, muestra 6 opciones variadas y puedes pedir cualquiera directamente por WhatsApp.';}
  if(root&&PRODUCTS.length){
    const selected={persona:'',ocasion:'',estilo:'',budget:''};let budget=null,cycle=0,currentKey='',lastShown=new Set();
    const summary=document.getElementById('reco-summary');
    const help=document.getElementById('reco-whatsapp');
    const reset=document.getElementById('reco-reset');
    const results=document.getElementById('reco-results');
    const resultTitle=document.getElementById('reco-result-title');
    function render(more){
      const labels=[];
      if(selected.persona)labels.push('Para: '+selected.persona);
      if(selected.ocasion)labels.push('Ocasión: '+selected.ocasion);
      if(selected.estilo)labels.push('Estilo: '+selected.estilo);
      if(selected.budget)labels.push('Presupuesto: '+selected.budget);
      summary.textContent=labels.length?labels.join(' · '):'Elige tus preferencias y te mostramos opciones entre los '+PRODUCTS.length+' productos cargados.';
      help.href='https://wa.me/'+WA+'?text='+encodeURIComponent('Hola Elite Scents RD, quiero una recomendación de perfume.\n'+labels.join('\n'));
      results.replaceChildren();
      if(!labels.length){results.hidden=true;resultTitle.textContent='';return;}
      const key=selectionKey(selected,budget);
      if(key!==currentKey){cycle=0;currentKey=key;}
      else if(more)cycle++;
      const ranked=rankedCandidates(selected,budget);
      const list=pickSix(ranked,cycle,lastShown);
      results.hidden=false;
      resultTitle.textContent=list.length?'6 opciones diferentes que encajan contigo':'No encontramos una coincidencia exacta';
      if(!list.length){const empty=document.createElement('div');empty.className='reco-empty';empty.textContent='Prueba cambiando una preferencia o ampliando el presupuesto. También puedes pedir ayuda directa por WhatsApp.';results.appendChild(empty);return;}
      const grid=document.createElement('div');grid.className='reco-grid';list.forEach(item=>grid.appendChild(recoCard(item,selected)));results.appendChild(grid);
      lastShown=new Set(list.map(item=>item.p.name));
      if(ranked.length>6){
        const wrap=document.createElement('div');wrap.className='reco-more-wrap';
        const button=document.createElement('button');button.type='button';button.className='btn btn-light reco-more';button.textContent='Ver otras 6 opciones';button.addEventListener('click',()=>render(true));
        wrap.appendChild(button);results.appendChild(wrap);
      }
    }
    root.addEventListener('click',function(event){
      const button=event.target.closest('[data-reco]');if(!button)return;
      const group=button.dataset.group;
      root.querySelectorAll('[data-reco][data-group="'+group+'"]').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
      button.classList.add('selected');button.setAttribute('aria-pressed','true');selected[group]=button.dataset.reco;
      if(group==='budget')budget={min:Number(button.dataset.min||0),max:Number(button.dataset.max||999999)};
      render(false);
    });
    reset.addEventListener('click',function(){
      Object.keys(selected).forEach(k=>selected[k]='');budget=null;cycle=0;currentKey='';lastShown=new Set();
      root.querySelectorAll('[data-reco]').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
      render(false);
    });
    render(false);
  }
})();