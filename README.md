# Compras Adelante — órdenes de compra, recepción y facturación

App web (Next.js 14, App Router) que Adelante Desarrollos usa **en producción** para armar
órdenes de compra, recibir material en bodega y manejar notas de crédito, integrada con
**Microsoft Dynamics 365 Business Central** y con SQL Server como base propia.

- Producción: `proveeduria.adelante.cr` (Azure App Service `app-ordenescompra-eus2`).
- Deploy: push a `main` → GitHub Actions (`.github/workflows/main_app-ordenescompra-eus2.yml`).
- Base: `AdelanteSBX` (SQL Server en Azure), compartida con la app de Producción.
- BC: entorno **Sandbox** (las pruebas de integración se hacen ahí, no en Production).

## Los 3 roles

Los roles salen de `dbo.UsuarioRol` al iniciar sesión (ver `lib/auth.ts`); cada uno entra a
su propio módulo:

| Rol (app) | Quién | Qué hace |
|---|---|---|
| `proveeduria` | Angie | Arma las órdenes de compra a partir de las solicitudes que manda Producción, y las **compras directas** (material sin solicitud). |
| `facturacion` | Bodega (Pedro) | Recibe el material y registra la factura. Soporta entregas **parciales** y marcar líneas para nota de crédito. |
| `contabilidad` | Kattya | Emite las notas de crédito, registra facturas que quedaron **en revisión** y aplica **cargos sobre factura** (flete de un tercero). |

**Ingeniería y Aprobación NO viven acá** — están en la app de Producción, que escribe en la
misma base. Los estados y las etiquetas de historial de esos roles se conservan para
auditoría.

### El flujo completo

1. Ingeniería (app de Producción) crea la solicitud y la **envía** a Proveeduría.
2. **Angie** arma la orden con líneas de esas solicitudes (o una compra directa) y la manda
   a aprobación. La orden queda `pendiente_aprobacion`; esta app **no** toca BC ahí.
3. **Aprobación** (app de Producción) aprueba y crea + lanza el pedido en BC → `lanzado`.
   **Lanzar a BC es solo de esa app**: esta no lo hace ni lo reintenta. Lo que Angie puede
   es *volver a abrir* una orden lanzada y reenviarla a aprobación.
4. **Bodega** recibe. Dos modos:
   - **Modo 1** — todo bien: recibir + facturar (va a BC con sus movimientos contables).
   - **Modo 2** — material bien pero factura con problemas: *recibir sin factura*; queda
     "en revisión" y **Contabilidad** registra el N.º después (Archivo y recepciones).
5. Líneas con problema (dañado / menos cantidad / precio distinto) se marcan al recibir y
   caen en **Notas de crédito**, donde Contabilidad las marca como *acreditadas* al emitirlas.

### Reglas de negocio que el código respeta

- **Entregas parciales**: `cantidad a recibir` por línea, acotada al pendiente; el saldo se
  conserva y la orden sigue abierta hasta recibir el 100 % de los **artículos**.
- **El flete/cargo no es material**: las líneas `tipo: "cargo"` no cuentan para el % recibido
  ni para "orden completa" (en SQL la regla es `tipoLinea='articulo'`). El flete se factura
  con la primera entrega.
- **Cargo de producto (Item Charge)**: todo cargo con importe necesita un **tipo** de BC;
  sin tipo BC lo rechaza y la orden queda lanzada sin flete.
- **Fechas**: `fecha de factura` = `fecha de registro` (es la que se cuadra contra el estado
  de cuenta del proveedor). La UI las sincroniza y avisa si difieren.
- **Una factura no se registra dos veces** en la misma orden (se valida en pantalla y en SQL).
- **Montos**: en listas y tiles los totales son **sin IVA** y se rotulan así; el detalle de la
  orden y de la recepción muestran Subtotal + IVA + Total con IVA.

## Correr en local

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # pruebas de las funciones puras (runner de Node, sin deps)
npx tsc --noEmit   # chequeo de tipos
npm run build      # build de producción
```

Node 18.18+ (probado en 22 y 26). `npm test` corre con el runner de Node y
`--experimental-strip-types` (hace falta en Node 22; en 23+ ya es el default), así que no
hay paso de compilación ni dependencias de testing. **Los archivos de prueba están listados
explícitamente en el script** —no por glob— para que el comando se comporte igual en CI:
si agregás un `*.test.ts`, sumalo ahí.

El workflow de deploy corre `npm test` **antes** del build: si una prueba falla, no se
despliega.

**Sin base ni BC, la app corre en modo prueba** (datos de `lib/seed.ts` en memoria +
`localStorage`). Para moverse entre roles en ese modo, en la consola del navegador:

```js
localStorage.setItem("adelante_oc_role", "proveeduria"); // proveeduria | facturacion | contabilidad
localStorage.setItem("adelante_oc_usuario", "Angie");
location.reload();
```

Otras llaves útiles: `adelante_oc_state_v3` (los datos de prueba — borrala para empezar de
cero), `adelante_oc_theme` (`light`/`dark`), `adelante_oc_navpin`.

Lo que **no** se puede probar en local: todo lo que dependa de SQL o de BC (bootstrap,
guardar, catálogos, existencias). Degrada con avisos en pantalla, que es justo el camino de
error que conviene revisar.

⚠️ **Correr `npm run build` con el dev server levantado rompe el preview**
(`Cannot find module './vendor-chunks/next.js'`): el build sobreescribe `.next/`. Arreglo:
parar el dev, `rm -rf .next`, volver a levantarlo.

## Configuración

Copiá `.env.local.example` a `.env.local`. Lo importante:

| Variable | Para qué |
|---|---|
| `SESSION_SECRET` | **Obligatoria en producción.** Firma la cookie de sesión. Si falta, nadie puede entrar (falla cerrado a propósito) y `authEnabled()` queda en false. |
| `USE_API` | Runtime: prende el modo SQL. En Azure va como App Setting. |
| `NEXT_PUBLIC_USE_API` | El mismo flag pero de *build*. `app/layout.tsx` necesita `export const dynamic = "force-dynamic"` para que gane el valor runtime; si no, el front queda horneado en modo prueba. |
| `SQL_*` / `SQL_CONNECTION_STRING` | Conexión a SQL Server. |
| `BC_*` | Credenciales de Business Central (client credentials) + entorno y compañía. |

### Sesión y seguridad

- Login contra `dbo.Usuario` con hash **bcrypt** (o SHA-256 legado). Nunca texto plano.
- La sesión es una cookie `httpOnly` + `secure` **firmada con HMAC-SHA256** (12 h). No se
  puede fabricar un rol desde la consola.
- `middleware.ts` protege las páginas y todo `/api/*`; solo `/api/login`, `/api/logout` y
  `/api/health` son públicas (y health, sin sesión, responde apenas `{ ok }`).
- Los intentos fallidos de login del mismo usuario se **van demorando** (250 ms por fallo,
  tope 2 s, se olvida a los 15 min). No se bloquean cuentas.
- Lo que queda en la bitácora (`usuario`, `rol`) se toma de la **cookie firmada**, no del
  body del request (`lib/actor.ts`).

## Estructura

```
app/
  page.tsx                  Login
  proveeduria/              Órdenes, solicitudes, compra directa, inventarios, dashboard
  facturacion/              Bodega (recibir, recibidas) + Contabilidad (NC, cargo, archivo)
  api/                      API routes (ver tabla abajo)
components/
  ui.tsx                    Design system (Button, Field, Select, Modal, Toast, Checkbox…)
  data-table.tsx            Tabla (TanStack): búsqueda, filtros, columnas, vistas, export
  combobox.tsx              Selector con buscador (teclado + ARIA de combobox)
  shell.tsx                 Topbar + nav por rol + ayuda contextual (ⓘ)
  orden-detalle.tsx         Detalle de orden reutilizado por Proveeduría y Bodega
  timeline.tsx              Historial por entidad (pide /api/movimientos)
lib/
  store.tsx                 Estado global + acciones. Alterna SQL (api.ts) vs mock (seed.ts)
  repo.ts                   Acceso a SQL Server (todas las tablas y la bitácora)
  bc.ts                     TODAS las llamadas a Business Central
  auth.ts / session.ts      Login y cookie firmada
  actor.ts                  Identidad real (de la cookie) para lo que se audita
  helpers.ts                Cálculos: saldos, % recibido, reparto de flete, formatos
  help.ts                   Textos de la ayuda ⓘ por pantalla
  *.test.ts                 Pruebas (`npm test`)
```

## API

| Método | Ruta | Acción |
|---|---|---|
| GET | `/api/health` | Ping (con sesión: conteos por tabla) |
| GET | `/api/bootstrap` | Carga inicial: pedidos, órdenes y recepciones |
| GET / POST | `/api/pedidos` | Listar / crear solicitud |
| GET / PATCH / PUT / DELETE | `/api/pedidos/[id]` | Detalle / estado (incluye devolver) / editar / borrar |
| GET / POST | `/api/ordenes` | Listar / crear orden |
| GET / PATCH / PUT | `/api/ordenes/[id]` | Detalle / estado / reescribir líneas |
| POST | `/api/recepciones` | Registrar recepción (con o sin factura) |
| PATCH | `/api/recepciones/[id]` | Modo 2: registrar el N.º de factura después |
| GET / POST | `/api/notas-credito` | Listar / marcar líneas para NC |
| PATCH | `/api/notas-credito/[id]` | Marcar acreditada / reabrir |
| GET | `/api/movimientos?entidad=&id=` | Bitácora de un documento |
| GET / POST | `/api/vistas`, `/api/vistas/[id]` | Vistas de tabla guardadas por usuario |
| GET | `/api/matriz`, `/api/clasificaciones`, `/api/mi-etapa` | Matriz obra×clasificación y WBS |
| GET | `/api/bc/vendors\|items\|almacenes\|obras\|itemcharges\|variants\|existencias\|jobtasks\|lastprice` | Catálogos de BC |
| GET | `/api/bc/orden-totales`, `/api/bc/recepciones-registradas` | Totales del pedido / líneas de recepción registradas |
| POST | `/api/bc/registrar`, `/api/bc/recibir`, `/api/bc/facturar-recibido` | Registrar en BC (recibir + facturar / solo recibir / facturar lo recibido) |
| POST | `/api/bc/cargo-recibido` | Cargo de un tercero sobre una recepción ya registrada |

Cada escritura deja un `Movimiento` (bitácora). Los estados de la app se mapean al catálogo
`dbo.Estado` (se crean los nombres que falten y se leen los de **todos** los módulos, para
que un estado escrito por la app de Producción no se lea como "borrador").

`dbo.OrdenCompraDet` necesita dos columnas nullable (`chargeNo`, `chargeMethod`) para no
perder el tipo de Cargo de producto de BC. Como esa tabla la comparte la app de Producción,
la app **no** las crea sola: hay que correr `db/migracion_cargo_cols.sql` (o poner el App
Setting `MIGRAR_ESQUEMA=1` una vez). Mientras no existan, todo funciona como antes, sin
guardar el tipo de cargo.

## Design system

Todo el UI sigue el **Adelante Design System**
(<https://davidpcad.github.io/adelante-design-system>): tipografía Roboto, verde `#add010`,
rojo `#c96c6c`, inputs tipo píldora, sombras suaves. Los tokens viven en `app/globals.css`
como variables `--ds-*`, con tokens semánticos (`--ds-bg`, `--ds-surface`, `--ds-text`,
`--ds-tint-base`) para tema claro/oscuro vía `data-theme`. **No hardcodear colores.**

## Decisiones pendientes (no las tomé yo)

- **Autorización por rol en la API.** `middleware.ts` autentica pero no autoriza: cualquiera
  con sesión válida puede llamar cualquier `/api/*` (p. ej. Bodega podría crear una orden por
  `curl`). Mapear rol→endpoint es fácil de equivocar porque hay rutas compartidas (Bodega y
  Contabilidad usan las mismas para registrar facturas), así que conviene definir la matriz
  antes de bloquear. Lo que YA está cubierto: la bitácora firma con la sesión, así que nadie
  puede escribir a nombre de otro.
- **`/api/vistas` y `/api/plantillas`** reciben el usuario por query/body. En vistas el
  borrado exige que coincida el dueño (`WHERE id=@id AND usuario=@usuario`), pero conociendo
  el nombre de alguien se pueden listar/borrar sus vistas; `deletePlantilla` no valida dueño.
  Son preferencias, no datos del negocio — pendiente decidir si vale atarlo a la sesión (ojo:
  si el nombre guardado no coincide exactamente, alguien podría "perder" sus vistas).
- **`bcHealth()`** (`/api/bc/health`, con sesión) devuelve un bloque de diagnóstico con el
  client id, el tenant, el largo del secreto y 5 probes contra BC. Sirve para depurar permisos,
  pero cuando eso esté resuelto conviene ponerlo detrás de un flag.
- **Notificaciones**: la campana solo se llena en modo prueba. Falta decidir si se generan
  server-side o si se saca de la topbar en producción.

## Pendientes conocidos

- **BC → Producción**: el tipo de cargo ya se guarda en SQL, pero para que llegue a BC en el
  flujo normal la app de Producción tiene que **leer** `chargeNo`/`chargeMethod` al crear el
  pedido.
- **Inventarios / Dashboard**: dependen de endpoints de BC (existencias por ubicación y Job
  Tasks) y del mapeo obra→almacén.
- **Rutas sin consumidor en esta app** (las pantallas que las usaban eran de Ingeniería, que
  se movió a Producción): `/api/plantillas`, `/api/matriz`, `/api/clasificaciones` y
  `/api/mi-etapa`, con sus funciones en `repo.ts`. No las borré por si Ingeniería vuelve acá;
  si se decide que no, se pueden eliminar junto con su CSS (`.tpl-card__*`, popup de
  plantillas).
