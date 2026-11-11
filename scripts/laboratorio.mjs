// CONSOLA DE ATAQUE INTERACTIVA (local y sin riesgo): levanta una copia de tu backend (base de datos con todas tus reglas
// de seguridad) y te deja escribir tus propios ataques SQL para ver, al instante, si la seguridad te bloquea. No toca
// Supabase ni la tienda real; no necesita ninguna clave. Pensada para que un amigo (con tu permiso) pruebe tu seguridad.
//
//   npm install --no-save @electric-sql/pglite    (una sola vez)
//   npm run laboratorio
//
// Te pones en la piel de un rol (visitante, cliente, atacante o administrador) y escribes SQL. El objetivo del "atacante"
// es robar datos ajenos (la cédula de Ana, su pedido, los costos, la lista de clientes). Si lo logra, encontró un hueco.
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.error('Falta el banco de pruebas. Instálalo con: npm install --no-save @electric-sql/pglite'); process.exit(2); }
import readline from 'node:readline';
import { montarLaboratorio, IDS, comoRol } from './lib/lab-backend.mjs';

const ROLES = {
  anon: { uid: null, nombre: 'VISITANTE sin cuenta (anon)' },
  cliente: { uid: IDS.VICTIMA, nombre: 'CLIENTA normal: Ana (quiere ver solo lo suyo)' },
  atacante: { uid: IDS.ATACANTE, nombre: 'ATACANTE con cuenta: Malo (quiere robar lo de Ana)' },
  admin: { uid: IDS.ADMIN, nombre: 'ADMINISTRADOR de la tienda (el jefe)' },
};
// En Supabase un cliente NO puede cambiar de rol ni falsificar su identidad (viene de un token firmado): aquí lo
// bloqueamos para que el laboratorio sea fiel a lo que de verdad puede hacer un atacante por la web.
const PROHIBIDO = /\b(set\s+(local\s+)?role|reset\s+role|set\s+session\s+authorization)\b|request\.jwt|set_config\s*\(\s*'request/i;

let db = await montarLaboratorio(PGlite);
let rol = 'atacante';
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

function banner() {
  console.log(`${C.b}🔬 CONSOLA DE ATAQUE — Elite Scents RD${C.x}  ${C.d}(copia local, no toca nada real)${C.x}
Escribe una consulta SQL y te digo si la seguridad te deja o te bloquea.

${C.b}Comandos:${C.x}
  ${C.y}rol${C.x} anon | cliente | atacante | admin    cambiar quién eres
  ${C.y}objetivos${C.x}     qué datos intentar robar (las "banderas")
  ${C.y}tablas${C.x}        ver las tablas de la base
  ${C.y}ejemplos${C.x}      ataques de ejemplo para copiar y pegar
  ${C.y}reiniciar${C.x}     volver a dejar la base limpia
  ${C.y}salir${C.x}
`);
}
function objetivos() {
  console.log(`${C.b}🎯 Lo que el ATACANTE intenta robar o cambiar (si lo logra, hay hueco):${C.x}
  1. La cédula de Ana        → select cedula from public.customer_profiles;
  2. El pedido de Ana        → select * from public.orders;
  3. Tus costos privados     → select * from public.product_costs;
  4. La lista de clientes    → select public.admin_list_customers();
  5. Cambiar un precio       → update public.products set price='RD$1' where id=1;
  6. Hacerse administrador   → insert into public.admin_users values ('${IDS.ATACANTE}');
${C.d}Como "atacante" deben salir vacíos o bloqueados. El admin ve la lista con la función admin_list_customers().${C.x}
`);
}
function ejemplos() {
  console.log(`${C.b}🧪 Ataques de ejemplo (copia, pega, cambia de rol y observa):${C.x}
  ${C.d}# Robo de datos ajenos (RLS)${C.x}
  select * from public.customer_profiles;
  select cedula, phone, address from public.customer_profiles where user_id='${IDS.VICTIMA}';
  ${C.d}# Inyección SQL clásica (intentar borrar una tabla)${C.x}
  select 1; drop table public.coupons;
  select * from public.coupons where code = 'x'' or ''1''=''1';
  ${C.d}# Escalar privilegios${C.x}
  insert into public.admin_users values ('${IDS.ATACANTE}');
  update public.store_settings set orders_paused=true where id;
`);
}

async function ejecutar(sql) {
  if (PROHIBIDO.test(sql)) {
    console.log(`${C.y}  ⛔ En Supabase un cliente no puede cambiar de rol ni falsificar su identidad (viene de un token firmado).`);
    console.log(`     Usa el comando "rol" del laboratorio para ponerte en otra piel.${C.x}`);
    return;
  }
  await comoRol(db, ROLES[rol].uid); // re-aplica el rol antes de cada intento (no se puede escalar entre comandos)
  try {
    const res = await db.exec(sql), ult = res.at(-1) || {};
    const filas = ult.rows || [];
    if (filas.length) {
      console.log(`${C.g}  ✅ te dejó ver ${filas.length} fila(s):${C.x}`);
      console.table(filas.slice(0, 20));
      if (filas.length > 20) console.log(`${C.d}  … y ${filas.length - 20} más${C.x}`);
    } else {
      const n = ult.affectedRows || 0;
      console.log(`${C.g}  ✅ ejecutado${C.x} ${C.d}(${n} fila(s) afectada(s); 0 filas devueltas = si buscabas datos ajenos, RLS te los ocultó)${C.x}`);
    }
  } catch (e) {
    const msg = String(e.message || e);
    if (/permission denied|row-level|must be owner|denied|not allowed/i.test(msg))
      console.log(`${C.r}  🛡️  BLOQUEADO — la seguridad te paró:${C.x} ${msg}`);
    else
      console.log(`${C.y}  ⚠️  error de SQL:${C.x} ${msg}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = () => { rl.setPrompt(`${C.b}${rol}>${C.x} `); rl.prompt(); };
banner(); objetivos();
console.log(`${C.d}Ahora eres: ${ROLES[rol].nombre}${C.x}\n`);
prompt();

async function manejar(t) {
  if (!t) return;
  const [cmd, ...args] = t.split(/\s+/);
  const bajo = cmd.toLowerCase();
  if (bajo === 'salir' || bajo === 'exit' || bajo === 'quit') return 'cerrar';
  if (bajo === 'ayuda' || bajo === 'help') return banner();
  if (bajo === 'objetivos') return objetivos();
  if (bajo === 'ejemplos') return ejemplos();
  if (bajo === 'rol') {
    const nuevo = (args[0] || '').toLowerCase();
    if (ROLES[nuevo]) { rol = nuevo; console.log(`${C.d}Ahora eres: ${ROLES[rol].nombre}${C.x}`); }
    else console.log(`${C.y}  Roles: anon | cliente | atacante | admin${C.x}`);
    return;
  }
  if (bajo === 'tablas') {
    await db.exec('reset role');
    try { const r = await db.query(`select table_name from information_schema.tables where table_schema='public' order by table_name`); console.log('  ' + r.rows.map(x => x.table_name).join(', ')); }
    catch (e) { console.log('  ' + e.message); }
    return;
  }
  if (bajo === 'reiniciar') { console.log(`${C.d}  Dejando la base limpia…${C.x}`); try { await db.close(); } catch {} db = await montarLaboratorio(PGlite); console.log('  Listo.'); return; }
  await ejecutar(t);
}
// Cola: aunque peguen varias líneas de golpe, se procesan de una en una y en orden.
const cola = []; let trabajando = false;
async function drenar() {
  if (trabajando) return; trabajando = true;
  while (cola.length) {
    const r = await manejar(cola.shift());
    if (r === 'cerrar') { trabajando = false; rl.close(); return; }
    prompt();
  }
  trabajando = false;
}
rl.on('line', linea => { cola.push(linea.trim()); drenar(); });
rl.on('close', async () => { try { await db.close(); } catch {} console.log(`\n${C.d}Laboratorio cerrado. Nada de esto tocó tu tienda real.${C.x}`); process.exit(0); });
