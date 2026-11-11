# Laboratorio de seguridad — Elite Scents RD

Una **copia local** del backend de la tienda (la base de datos con TODAS sus reglas de seguridad) para
probar ataques sin tocar la tienda real ni a los clientes. Pensado para aprender y para que alguien, con
permiso del dueño, ponga a prueba la seguridad.

## Cómo correrlo

Necesitas [Node.js](https://nodejs.org) y el proyecto clonado. Una sola vez:

```bash
npm install --no-save @electric-sql/pglite
```

Luego:

```bash
npm run lab           # batería automática: 33 ataques, dice cuáles rebotan
npm run laboratorio   # consola interactiva: escribes tus propios ataques en SQL
npm run serve         # abre la página (el frontend) en tu computadora
```

## La consola interactiva (`npm run laboratorio`)

Te pones en la piel de un rol y escribes consultas SQL. La consola te dice si la seguridad te **bloqueó**
o te **dejó ver** algo.

- `rol anon` — visitante sin cuenta
- `rol cliente` — Ana, una clienta normal (solo debe ver lo suyo)
- `rol atacante` — Malo, con cuenta, intentando robar lo de Ana
- `rol admin` — el administrador de la tienda
- `objetivos` — las "banderas" a robar · `ejemplos` — ataques para copiar · `tablas` · `reiniciar` · `salir`

**La idea:** como `atacante`, intenta leer la cédula de Ana, su pedido, los costos o la lista de clientes.
Si lo logras, encontraste un hueco. Como `admin`, esos mismos datos **sí** aparecen: esa es la diferencia
entre no tener permiso y tenerlo.

## Reglas del juego (rules of engagement)

Esto mantiene la prueba útil y legal:

1. **Robar o cambiar datos** (RLS, login, inyección SQL): ✅ dale con todo, aquí y contra la API real
   (son intentos, no rompen nada). Si sacas un dato ajeno, es un hallazgo real: repórtalo.
2. **Tumbar la página** (DoS, saturar): ⚠️ **solo contra este laboratorio local**, nunca a lo bruto contra
   GitHub o Supabase reales — es infraestructura compartida y viola sus términos de servicio (te pueden
   suspender la cuenta). Eso no prueba nada.
3. Lo que encuentres, se verifica y se arregla. El mejor final es encontrar un hueco y taparlo.

## Qué NO cubre este laboratorio

Prueba la **base de datos** (RLS, funciones, permisos, inyección), que es lo más crítico. No reemplaza:

- El chequeo contra el Supabase de verdad: `npm run test:security` (solo lee, no escribe).
- La capa de red real (TLS, CDN, límites de GitHub Pages), que se razona aparte.
