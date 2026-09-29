# Cómo está hecha Compras Adelante

Guía para un compañero que está armando **otra app** y quiere el mismo lenguaje de
interfaz: los tokens, los componentes, las interacciones y —sobre todo— las barras y
menús que forman el chasis.

No es documentación de las pantallas de compras. Es **cómo está construida la capa de
UI y por qué**, con el código concreto para copiar. Cada decisión que parece rara acá
salió de un reporte real de las tres personas que usan la app todo el día, así que van
anotadas con su motivo: si en tu app el motivo no aplica, no copiés la decisión.

---

## 0. Resumen de una pantalla

| Qué | Cómo |
|---|---|
| Framework | Next.js 14 (App Router) + React 18 + TypeScript |
| Estilos | **CSS plano en un solo archivo** (`app/globals.css`, ~2600 líneas) con variables `--ds-*` |
| UI kit | Propio (`components/ui.tsx`, ~520 líneas). Sin Tailwind, sin shadcn, sin MUI, sin CSS-in-JS |
| Íconos | Propios, paths del design system en un objeto TS (`components/ds-icon.tsx`). Sin librería de íconos |
| Tabla | TanStack Table (headless) + CSS propio |
| Tipografía | Roboto por `<link>` de Google Fonts (400/500/600/700) |
| Estado | Un solo Context (`lib/store.tsx`) + `localStorage`/`sessionStorage` |
| Tema | Claro/oscuro con `<html data-theme>` y script anti-parpadeo |
| Dependencias de UI | **cero** |

La regla de oro: **el diseño vive en los tokens, no en los componentes**. Un componente
nuevo que no escribe ni un color literal hereda el tema oscuro gratis.

---

## 1. Mapa de carpetas

```
app/
  layout.tsx          <html>, script del tema, fuente, providers globales
  globals.css         TODO el CSS de la app (tokens + componentes + pantallas)
  page.tsx            Login
  <modulo>/…          Las pantallas, una carpeta por rol
  api/…               Route handlers
components/
  ui.tsx              Primitivos: Button, Field, Input, Select, Textarea, Checkbox,
                      Badge, Card, Tile, FiltroChip, Skeleton, QtyRing, ProgressBar,
                      EmptyState, Modal, ConfirmDialog, ToastProvider/useToast
  shell.tsx           EL CHASIS: topbar + riel/drawer + FABs + ayuda + notificaciones
  ds-icon.tsx         Paths de los íconos (objeto `ICON_PATHS` + `ALIASES`)
  icons.tsx           Un export por ícono, construido con una fábrica sobre ds-icon
  data-table.tsx      Tabla reutilizable (TanStack) con toda la mecánica de la app
  combobox.tsx        Selector con buscador (ARIA combobox completo)
  date-field.tsx      Campo de fecha con calendario propio
  calendario-rango.tsx Rango de fechas (dos meses, atajos)
  timeline.tsx        Historial de un documento
lib/
  store.tsx           Estado global + acciones
  haptic.ts           Vocabulario de vibración (semántico)
  help.ts             Textos de la ayuda contextual, por ruta
  navegacion.ts       Registro de navegación de la pestaña (entrada vs. vuelta)
  memoria-tabla.ts    Qué recuerda una tabla y por cuánto tiempo
```

Tres cosas que valen la pena copiar tal cual como **estructura**:

1. **Un solo `globals.css`.** Con tokens y comentarios que explican el porqué, 2600
   líneas se navegan mejor que 40 archivos de módulos. Los comentarios son parte del
   entregable: cada bloque raro dice qué incidente lo produjo.
2. **`ui.tsx` es la única fuente de primitivos.** Si falta una variante, se agrega ahí.
   Nunca una copia local en una pantalla.
3. **Los íconos son datos, no componentes.** Un objeto `{nombre: "M12 2L..."}` y una
   fábrica de 10 líneas. Cambiar el set es cambiar un objeto.

---

## 2. La capa de tokens (esto es lo más importante)

### 2.1 Dos capas de color, y la distinción importa

```css
:root {
  /* ── CAPA PRIMITIVA DE MARCA: no cambia con el tema ── */
  --ds-color-white: #fff;
  --ds-color-black: #000;
  --ds-color-black-100: #000c;
  --ds-color-surface: #f3f3f3;
  --ds-color-gray-100: #ebebeb;
  --ds-color-gray-200: #d9d9d9;
  --ds-color-gray-300: #aaafb6;
  --ds-color-gray-400: #747b86;
  --ds-color-gray-500: #5d636c;
  --ds-color-yellow:  #f0c802;
  --ds-color-green-100: #add010;   /* verde de marca (rellenos) */
  --ds-color-green-200: #88a024;   /* verde oscuro (bordes, texto sobre claro) */
  --ds-color-green-300: #5f7a1a;   /* verde de TEXTO: pasa AA sobre fondo claro */
  --ds-color-red-100: #c96c6c;
  --ds-color-red-200: #bb4a4a;

  /* ── CAPA SEMÁNTICA DE SUPERFICIE: esto es lo que el tema remapea ── */
  --ds-bg: var(--ds-color-surface);     /* fondo de página */
  --ds-surface: var(--ds-color-white);  /* tarjetas, inputs, popovers, topbar */
  --ds-surface-2: var(--ds-color-white);/* superficie elevada */
  --ds-text: var(--ds-color-black);     /* texto del cuerpo */
  --ds-tint-base: var(--ds-color-white);/* base de los color-mix sutiles */

  /* Columna oscura del riel: oscura en los DOS temas → se define una sola vez */
  --ds-nav-bg: #2a2a2a;

  /* Semántica de estado (nunca es el único portador de significado) */
  --st-open: var(--ds-color-gray-400);
  --st-launched: var(--ds-color-green-200);
  --st-pending: var(--ds-color-yellow);
  --st-partial: var(--ds-color-red-100);
  --st-done: var(--ds-color-green-200);

  color-scheme: light;
}
```

**La regla que hay que entender:** UI nueva usa `--ds-bg / --ds-surface / --ds-surface-2
/ --ds-text / --ds-tint-base`. `--ds-color-white` y `--ds-color-black` quedan para
**blanco y negro literales de marca**: texto sobre un botón de color, el encabezado
negro de tabla, los checkmarks, los toasts. Esos no cambian con el tema **a propósito**.

Los tintes sutiles nunca se escriben a mano, se mezclan contra `--ds-tint-base`:

```css
background: color-mix(in srgb, var(--ds-color-green-100) 12%, var(--ds-tint-base));
```

Así el mismo tinte “verde clarito” funciona en claro (mezcla hacia blanco) y en oscuro
(mezcla hacia el gris oscuro). Un `#f2f8e6` escrito a mano rompe el oscuro **en
silencio**: nadie se entera hasta que alguien abre la app de noche.

### 2.2 Tema oscuro: invertir la rampa, no repintar la app

```css
:root[data-theme="dark"] {
  color-scheme: dark;
  --ds-bg: #16181d;
  --ds-surface: #212530;
  --ds-surface-2: #262b36;
  --ds-tint-base: #262b36;      /* los tintes se mezclan hacia el oscuro */
  --ds-text: #e8eaed;
  --ds-color-surface: #2a2f3a;

  /* Rampa INVERTIDA: 100 = relleno más oscuro … 500 = texto más claro */
  --ds-color-gray-100: #2c313c;
  --ds-color-gray-200: #3a4150;
  --ds-color-gray-300: #6b7280;
  --ds-color-gray-400: #9aa1ad;
  --ds-color-gray-500: #c3c8d1;
  --ds-color-green-300: var(--ds-color-green-100); /* sobre oscuro el verde de marca sí contrasta */

  --ds-shadow-01: 0 4px 8px #00000059;
  --ds-shadow-02-soft: 0 0 6px #00000066;
  --ds-shadow-03-big: 0 2px 4px #0000006b, 0 0 6px #0000006b;
  --ds-shadow-bar: 0 -8px 24px #00000091;
}
```

El truco es la **rampa invertida**: `gray-100` siempre significa “el relleno más sutil”
y `gray-500` siempre “el texto gris más fuerte”. Como todas las reglas usan el rol y no
el valor, el 95 % del CSS no se toca para el modo oscuro.

Lo que sí hay que arreglar a mano son los **pocos casos donde hay texto sobre un relleno
de marca sólido** (verde/amarillo no cambian, pero `--ds-text` sí):

```css
:root[data-theme="dark"] .ds-btn--green,
:root[data-theme="dark"] .topnav__item.is-active { color: var(--ds-color-black); }
```

### 2.3 El script anti-parpadeo (va en `<head>`, antes de pintar)

```tsx
<script dangerouslySetInnerHTML={{ __html:
  `(function(){try{var t=localStorage.getItem('app_theme');
    if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
    document.documentElement.setAttribute('data-theme',t);}catch(e){}})();` }} />
```

Sin esto, la app pinta claro y salta a oscuro. Con `suppressHydrationWarning` en
`<html>` porque el atributo lo pone el script y no el server.

### 2.4 Tipografía: escala fija de seis pasos

```css
--ds-font-family: "Roboto", "Segoe UI", sans-serif;
--ds-font-size-body-sm: 12px;   --ds-line-height-body-sm: 16px;
--ds-font-size-label: 14px;     --ds-line-height-label: 20px;
--ds-font-size-body-md: 16px;   --ds-line-height-body-md: 24px;
--ds-font-size-subtitle: 20px;  --ds-line-height-subtitle: 24px;
--ds-font-size-subtitle-lg: 24px;
--ds-font-size-heading: 32px;   --ds-line-height-heading: 40px;
--ds-font-weight-regular: 400;
--ds-font-weight-semibold: 600;
```

Clases utilitarias: `.ds-heading` · `.ds-subtitle-lg` · `.ds-subtitle` · body (default)
· `.ds-label` · `.ds-body-sm`, más `.ds-muted` (gris-400) y `.ds-strong` (600).

- Solo **dos pesos nombrados** (400 y 600). El 700 se usa a propósito en etiquetas
  chiquitas en mayúsculas, badges y avatares. **800 y 900 no existen**: Roboto no los
  trae y el navegador los resuelve a 700 sin diferencia (medido: mismo ancho al pixel).
- Números tabulares con `.ds-num` (`text-align: right; font-variant-numeric: tabular-nums`).
  Una columna de plata sin esto baila.
- El heading achica solo en móvil: `@media (max-width: 640px) { .ds-heading { font-size: clamp(24px, 7vw, 32px) } }`.
- **No migrar a `next/font`** si el paquete estático de la fuente no trae el peso que usás
  (acá el build falla por el 600). El `<link>` con `preconnect` es suficiente.

### 2.5 Radios, espacios, sombras

```css
--ds-radius-sm: 4px;  --ds-radius-md: 8px;  --ds-radius-lg: 16px;  --ds-radius-xl: 32px;
--ds-space-1: 4px; --ds-space-2: 8px; --ds-space-3: 12px;
--ds-space-4: 16px; --ds-space-5: 20px; --ds-space-6: 24px; --ds-space-10: 40px;

--ds-shadow-01:      0 4px 8px #aaafb640;              /* tarjetas, botón sm */
--ds-shadow-02-soft: 0 0 6px #00000029;                /* botón blanco, topbar */
--ds-shadow-03-big:  0 2px 4px #00000029, 0 0 6px #00000029;  /* botones sólidos */
--ds-shadow-bar:     0 -4px 18px #0000001f;            /* barras fijas al pie */
```

Reglas de forma:
- **La elevación es por sombra, nunca por borde.** Una tarjeta no lleva `border`.
- `--ds-radius-lg` (16px) es el radio por defecto de tarjetas y botones.
- Los **inputs son píldoras** (`--ds-radius-xl`, 32px). El `textarea` no (16px).
- Los badges son píldora completa (`999px`).
- El encabezado de tabla usa 12–14px en las esquinas de los extremos.

---

## 3. Los primitivos (`components/ui.tsx`)

### 3.1 Button

```tsx
<Button>Guardar</Button>                      // verde (primaria)
<Button variant="red">Eliminar</Button>
<Button variant="white" size="sm">Ver</Button>
<Button variant="black" block>Entrar</Button>
<Button loading={enviando}>Enviar</Button>
<Button icon aria-label="Cerrar"><IconClose /></Button>
```

- Variantes reales: `green` (primaria) · `red` (destructiva) · `white` (secundaria) ·
  `black` · `gray` (deshabilitado). `ghost`/`outline`/`yellow` existen como **alias** en
  el componente y se renderizan como las reales. Eso evita que cada pantalla invente una.
- Tamaños: `md` = **56px** de alto (el control normal), `sm` = **44px** y radio de
  píldora, `lg` = 64px. Esos números son objetivos táctiles: no bajar de ahí en nada que
  se use con el dedo.
- **`loading` deja el botón inerte solo**, sin depender de que la pantalla se acuerde de
  pasar `disabled`, y pone `aria-busy`. Motivo real: cada acción escribe en el ERP; un
  segundo clic creaba un segundo pedido de verdad.
- **Haptics semánticos** en `onPointerDown` (`haptic.delete` para la destructiva,
  `haptic.select` para el resto). `onClick` queda intacto para activación por teclado.

La firma táctil del sistema es el **anillo de 8px al presionar**, no un “hover-lift”:

```css
.ds-btn--green:active { box-shadow: 0 0 0 8px var(--ds-color-green-200), var(--ds-shadow-03-big); }
.ds-btn--red:active   { background: var(--ds-color-red-200);
                        box-shadow: 0 0 0 8px var(--ds-color-red-100), var(--ds-shadow-03-big); }
```

El botón **no se mueve** al presionarlo: crece un anillo de color alrededor. Eso, más
la ausencia total de `transform: translateY(-2px)` en hover, es la mitad de la
personalidad del sistema. La otra mitad es que **la sombra nunca se mueve**: ningún
componente del sistema cambia su `box-shadow` en hover. El hover cambia el COLOR —del
borde o del relleno—, y el estado se dice con un borde parejo:

```css
/* hover = relleno, no elevación (es el modificador `--filled` de la Card) */
.ds-card--interactive:hover { background: var(--ds-color-gray-100); }
/* estado = borde parejo de 2 px, y el campo PIERDE la sombra */
.ds-form-field--x .ds-form-field__input           { border: 2px solid var(--ds-color-green-100); box-shadow: none; }
.ds-form-field--advertencia .ds-form-field__input { border: 2px solid var(--ds-color-red-100);   box-shadow: none; }
```

Las sombras son exactamente tres —`--ds-shadow-01` para tarjetas y campos en reposo,
`--ds-shadow-03-big` para botones y popovers, `--ds-shadow-02-soft` para el resto— y no
hay una cuarta. Un halo translúcido tipo `0 0 0 3px color-mix(...)` no existe en el
sistema: para foco va `outline: 2px solid` con `outline-offset`.

### 3.2 Field + Input + Textarea

```tsx
<Field label="Proveedor" help="Sale del catálogo del ERP">
  <Input value={v} onChange={…} />
</Field>
<Field label="Nota" warning help="Falta el motivo">
  <Textarea rows={3} />
</Field>
```

`Field` **asocia el label con el input automáticamente**: si el hijo es un elemento
único y no trae `id`, le inyecta uno con `useId()` y apunta el `htmlFor` ahí. Nadie
tiene que acordarse de los ids, y la a11y sale sola.

Estados del campo, todos por borde (nunca por fondo):

```css
.ds-form-field__input {
  background: var(--ds-surface); border: 2px solid transparent;
  border-radius: var(--ds-radius-xl); box-shadow: var(--ds-shadow-01);
  padding: var(--ds-space-4) var(--ds-space-5);
}
.ds-form-field__input:focus { border-color: var(--ds-text); box-shadow: none; }  /* foco: borde negro, sin sombra */
.ds-form-field--x .ds-form-field__input { border-color: var(--ds-color-green-100); }        /* válido */
.ds-form-field--advertencia .ds-form-field__input { border-color: var(--ds-color-red-100); } /* error */
```

En reposo el campo tiene **sombra y no borde**; al enfocar **gana borde y pierde
sombra**. Es un intercambio, no una suma: el campo no “crece” al enfocarse.

### 3.3 Select (dropdown propio, no `<select>` nativo)

API compatible con el nativo (`value`, `onChange(e.target.value)`, hijos `<option>`)
pero el menú lo dibuja el sistema de diseño. Lo que hay adentro y vale copiar:

- **El menú va en un portal con `position: fixed`.** Un menú absoluto adentro de una
  tabla con `overflow-x` queda recortado; por eso las celdas terminaban usando el
  `<select>` feo del sistema.
- **Se reposiciona en `scroll` (con capture) y `resize`**, y decide abrir hacia arriba si
  abajo quedan menos de 260px.
- Ancho: `minWidth` = el ancho del campo, `width: max-content`, y
  `maxWidth: min(90vw, 420px, espacio-disponible)`. Un menú fijo que se sale de la
  ventana **no genera scroll**: simplemente no se puede leer.
- **Buscador automático** cuando hay más de 4 opciones. Enter en el buscador elige la
  primera coincidencia.
- Teclado completo: ↓/↑ recorren, Escape cierra y devuelve el foco al campo, **Tab
  cierra sin `preventDefault`** para que el salto siga normal (sin esto, adentro de un
  modal la trampa de foco veía el foco “afuera” —el menú vive en el `<body>`— y
  tironeaba el foco al principio).
- `role="listbox"` + `role="option"` + `aria-selected` + `aria-expanded`.

Si armás un dropdown propio, esos cinco puntos son el 90 % de los bugs que vas a tener.

### 3.4 Checkbox, Badge, Card, Tile, FiltroChip

```tsx
<Checkbox checked={x} onChange={…} label="Incluir cargos" />
<Badge tone="green">Lanzada</Badge>          // gray | green | yellow | red
<Card interactive onClick={…}>…</Card>       // flat = outlined (sin sombra, con borde)
<Tile value="14" label="Por recibir" accent="var(--ds-color-yellow)" onClick={…} active />
<FiltroChip value={7} label="Pendientes" accent="var(--st-pending)" onClick={…} active />
```

- El `Badge` lleva un **punto de color antes del texto** (`::before`), porque el color
  nunca es el único portador del significado.
- `Tile` es un marcador de 120px de alto con un acento de 36×4px arriba. Cuando su único
  trabajo es **filtrar** una tabla y el número grande ya vive en otro lado, existe
  `FiltroChip`: mismo contrato, 40px de alto. Motivo real: los recuadros empujaban la
  tabla fuera de la pantalla.

### 3.5 Modal y ConfirmDialog

```tsx
<Modal title="Registrar factura" wide onClose={cerrar} footer={<><Button variant="outline">Cancelar</Button><Button>Guardar</Button></>}>
  …
</Modal>

<ConfirmDialog message="¿Eliminar la línea 3?" confirmLabel="Eliminar" tone="red"
  onConfirm={…} onCancel={…} />
```

Todo lo que hace `Modal` y que hay que copiar sí o sí:

1. **Portal al `<body>`.** Un overlay `position: fixed` se posiciona contra el viewport
   *solo si ningún ancestro tiene `transform` o `filter`*. Con uno (acá, la animación de
   entrada de `.page`), el diálogo deja de cubrir la pantalla y sale cortado arriba.
2. **Trampa de foco**: Tab cicla adentro, Shift+Tab también, foco al primer elemento al
   abrir y **de vuelta al disparador al cerrar**.
3. **Escape cierra**, con el `onClose` guardado en un ref para que el efecto corra una
   sola vez y no robe el foco cuando el padre re-renderiza al tipear.
4. **Bloquea el scroll del fondo** (`body.style.overflow = "hidden"`) y lo restaura.
5. `role="dialog"` + `aria-modal` + `aria-labelledby` apuntando al título.
6. `min-width: 0` en el `.modal`: es un item de grid centrado, y un item de grid tiene
   `min-width: auto`, así que una tabla adentro lo estiraba **más allá de su `max-width`**
   y el diálogo se salía por los dos lados.

`ConfirmDialog` reemplaza a `window.confirm` para todo lo destructivo.

### 3.6 Toasts

```tsx
const toast = useToast();
toast("Recepción registrada · CP-005449", "success");   // "success" | "error" | "info"
```

La duración **depende del texto**, no es fija:

```ts
const vida = Math.min(12000, 3200 + text.length * 45);
```

Motivo: con 3,2 s para todos, los avisos largos —el que trae el número con el que la
factura quedó en el ERP— se iban antes de poder anotarlos. `role="alert"` +
`aria-live="assertive"` para los de error, `status`/`polite` para el resto.

### 3.7 Estados de carga y vacío

- `<Skeleton width={240} height={30} radius={8} />` — barra fantasma con shimmer,
  `aria-hidden`.
- `<EmptyState icon={…} title="No hay órdenes por recibir" hint="…" />` — ícono en
  círculo + título + pista.
- `<ProgressBar value={7} total={10} />` y `<QtyRing recibida={7} total={10} />` —
  progreso lineal y anillo (`conic-gradient`), con color por estado: gris (nada),
  amarillo (parcial), verde (completo).

**Regla de carga que vale copiar:** nunca un “Cargando…” sobre una página en blanco. Se
pinta **el chasis** (riel + topbar en su lugar de siempre) con el contenido en skeleton,
así la pantalla que llega no aterriza sobre el vacío, solo se rellena:

```tsx
function ChasisCargando() {
  return (
    <div className="app-shell" aria-busy="true">
      <header className="topbar"><div className="topbar__spacer" /></header>
      <nav className="app-nav" aria-hidden />
      <div className="app-content"><main className="page">
        <Skeleton width={240} height={30} /> …
      </main></div>
    </div>
  );
}
```

---

## 4. El chasis: barras y menús (`components/shell.tsx`)

Esta es la parte que preguntaste con más detalle. El `AppShell` envuelve **todas** las
pantallas de un rol y arma cinco piezas:

```
┌──────────────────────────────────────────────────────────────┐
│ ▤ │                 TOPBAR (sticky, 64px)                    │  ← barra de arriba
│ ─ ├──────────────────────────────────────────────────────────┤
│ R │                                                          │
│ I │                    .app-content > .page                  │
│ E │                                                          │
│ L │                                          [ + Acción ]    │  ← FAB abajo-der
│   ├──────────────────────────────────────────────────────────┤
│ ▤ │  ACTION-BAR fija al pie (solo con selección)             │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 La estructura del menú vive en un objeto, no en JSX

```tsx
type NavItem = { href: string; label: string; icon: IconCmp; alt?: string[] };

const ROLE_META: Record<Role, {
  label: string; persona: string; home: string; color: string;
  nav: NavItem[]; action?: { href: string; label: string };
}> = {
  proveeduria: {
    label: "Proveeduría", persona: "Angie",
    home: "/proveeduria/compras?vista=resumen",
    action: { href: "/proveeduria/directa", label: "Compra directa" },   // → FAB
    nav: [
      { href: "/proveeduria/compras", label: "Órdenes de compra", icon: IconReceipt,
        alt: ["/proveeduria$", "/proveeduria/ordenes", "/proveeduria/nueva"] },
      { href: "/proveeduria/devoluciones", label: "Devoluciones", icon: IconWarning },
      …
    ],
  },
  facturacion: { … },   // Bodega: 2 entradas
  contabilidad: { … },  // 4 entradas
};
```

Una sola tabla decide: qué entradas ve cada rol, a dónde va su “home”, cuál es su acción
principal (el FAB), y qué rutas extra encienden cada entrada (`alt`).

**El cálculo del ítem activo** es por *match más largo*, no por `startsWith` simple.
Sin esto, `/proveeduria/ordenes` encendía dos entradas a la vez:

```tsx
const activeHref = meta.nav
  .map((n) => {
    let len = pathname.startsWith(n.href) ? n.href.length : 0;
    for (const a of n.alt ?? []) {
      if (a.endsWith("$")) { if (pathname === a.slice(0, -1)) len = Math.max(len, 1000); } // ruta exacta
      else if (pathname.startsWith(a)) len = Math.max(len, a.length);
    }
    return { href: n.href, len };
  })
  .filter((x) => x.len > 0)
  .sort((a, b) => b.len - a.len)[0]?.href ?? "";   // sin match → NINGUNA encendida
```

El `?? ""` importa: cuando no hay match, no se enciende ninguna. Caer al home marca la
primera entrada como activa en pantallas que no son esa, y eso desorienta.

### 4.2 El riel (desktop): **binario**, no hover-expand

```css
.app-shell { --nav-w: 264px; }

.app-nav {
  position: fixed; left: 0; top: 0; z-index: 60;
  width: 72px; height: 100dvh; overflow: hidden;
  display: flex; flex-direction: column; gap: var(--ds-space-2);
  padding: var(--ds-space-4) 14px;
  background: var(--ds-nav-bg);          /* oscuro en los DOS temas */
}
/* El contenido SIEMPRE reserva el riel colapsado; al fijar, se empuja */
.app-content, .topbar { margin-left: 72px; }
.app-shell.pinned .app-nav { width: var(--nav-w); overflow-y: auto; }
.app-shell.pinned .app-content,
.app-shell.pinned .topbar { margin-left: var(--nav-w); }

/* Las transiciones se activan con .is-ready para NO animar en el primer pintado */
.app-shell.is-ready .app-nav { transition: width .26s cubic-bezier(.34, 1.2, .5, 1); }
.app-shell.is-ready .topbar,
.app-shell.is-ready .app-content { transition: margin-left .26s cubic-bezier(.34, 1.2, .5, 1); }
```

Decisiones, con su motivo:

- **72px colapsado / 264px fijado.** Nada intermedio.
- **No se expande al pasar el mouse.** Hubo hover-expand y se quitó: en una herramienta
  que se usa 8 horas, un panel que aparece solo cuando el cursor pasa cerca es ruido.
  El toggle es una hamburguesa **siempre visible** en la cabecera del riel.
- **Empuja el contenido, nunca lo tapa.** Por eso la transición es de `width` y
  `margin-left` y no de `transform`. *Está medido*: animar width/margin cuesta 0,7 ms de
  los 16,7 ms del frame. Pasarlo a `transform` rompería el empuje y no ganaría nada.
- **El estado se recuerda** en `localStorage` (`navpin`), y `is-ready` se pone en un
  efecto después de leerlo, así que al cargar el riel aparece ya en su ancho sin animar.
- El fondo es `--ds-nav-bg` y **es oscuro en los dos temas**. Es la única superficie así.

Los ítems, colapsado vs. expandido, sin duplicar markup: el texto vive en un `<span
class="app-nav__label">` que pasa de `max-width: 0; opacity: 0` a `max-width: 200px;
opacity: 1`.

```css
.app-nav__item {
  display: flex; align-items: center; gap: 0;
  width: 100%; min-height: 46px; justify-content: center; padding: 0;
  border: 0; border-radius: var(--ds-radius-lg);
  background: transparent; color: rgba(255,255,255,.74);
  transition: background .14s ease, color .14s ease, padding .2s cubic-bezier(.34,1.2,.5,1);
}
.app-nav__item:hover { background: rgba(255,255,255,.10); color: var(--ds-color-white); }
.app-nav__item.is-active {
  background: var(--ds-color-green-100); color: var(--ds-text);
}
.app-nav__label {
  overflow: hidden; white-space: nowrap; max-width: 0; opacity: 0;
  transition: max-width .26s cubic-bezier(.34,1.2,.5,1), opacity .18s ease;
}
.app-shell.pinned .app-nav__label { max-width: 200px; opacity: 1; }
.app-shell.pinned .app-nav__item { justify-content: flex-start; padding: 0 18px; gap: var(--ds-space-3); }
```

**Punto rojo de aviso.** Va sobre el **ícono**, no sobre la fila, para que se vea igual
colapsado y expandido. Lleva un anillo del color del fondo para separarse de los trazos:

```css
.app-nav__dot { position: absolute; top: -2px; right: -3px; width: 8px; height: 8px;
  border-radius: 50%; background: var(--ds-color-red-200);
  box-shadow: 0 0 0 2px var(--ds-nav-bg); }
.app-nav__item.is-active .app-nav__dot { box-shadow: 0 0 0 2px var(--ds-color-green-100); }
```

Y el aviso sale **del dato**, no de que el usuario “lea” algo (al revés de la campanita):
cuenta solo lo **accionable**. Lo que sigue esperando a otra persona no cuenta, porque no
hay nada que hacer con eso y el número no bajaría nunca. Con aviso, el `aria-label` dice
cuántas hay (`"Devoluciones · 3 por atender"`): un punto solo no le sirve a quien usa
lector de pantalla.

**Pie del riel** (`margin-top: auto`), separado por un filo de 1px:

1. **Interruptor de tema** — ítem normal con una perilla de 38×22 a la derecha. La
   etiqueta lleva `flex: 1` y empuja la perilla; colapsado, ambas miden 0 y el ícono
   queda centrado. El estado real vive en `<html data-theme>`, el componente solo lo
   refleja y alterna.
2. **Tarjeta de usuario** — avatar verde con las 2 iniciales, nombre + rol, y botón de
   salir. Colapsada se **oculta con `display: none`** (un grid no colapsa con
   `max-width` como los `<span>`), así el avatar queda centrado.
3. Cerrar sesión pasa por `ConfirmDialog`, borra la caché local y recién ahí navega.

**Tooltips en el riel colapsado: `title` nativo, no el tooltip bonito.** `.ds-tip` usa
`::after` con `position: absolute`, y el riel tiene `overflow: hidden` — el tooltip
quedaría cortado. El `.ds-tip` bonito se usa **solo en la topbar**.

### 4.3 La topbar

```css
.topbar {
  position: sticky; top: 0; z-index: 50;
  background: var(--ds-surface); box-shadow: var(--ds-shadow-02-soft);
  display: flex; align-items: center; gap: var(--ds-space-4);
  min-height: 64px; padding: var(--ds-space-3) var(--ds-space-6);
}
```

De izquierda a derecha: un `.topbar__spacer` (`flex: 1`) y después, pegado a la derecha,
`.topbar__user` con cuatro cosas:

1. **Chip de frescura** (`.sync-chip`) — solo en modo con base de datos. Dice “Al día” /
   “hace 3 min” / “Sin conexión” / “Sesión vencida”, con punto verde-amarillo-rojo, y **es
   clickeable** para forzar la sincronización sin recargar. Existe porque la app se
   refresca sola cada 45 s y eso el usuario no lo puede ver: sin el indicador, “estar al
   día” era un acto de fe.
2. **Botón ⓘ de ayuda contextual** — abre un `Modal` con “Para qué sirve” + “Paso a
   paso” + “Tips” **de la pantalla actual**. Todo el texto vive en un solo archivo
   (`lib/help.ts`) indexado por ruta. Es de lo más barato/rentable que tiene la app:
   tres personas con tres modelos mentales distintos y cero capacitación formal.
3. **Campanita de notificaciones** — panel en popover con overlay que cierra al hacer
   clic afuera, Escape cierra, badge con el conteo (`9+` de tope). Abrir el panel **no**
   marca leídas: cada una se marca al abrirla, o con “Marcar todas”.
4. **Pill de identidad** — avatar (2 iniciales) + “Nombre · Rol”, fondo negro.

```tsx
<button className="notif-bell ds-tip" data-tip="Qué es esta pantalla"
        title="Qué es esta pantalla" aria-haspopup="dialog">…</button>
```

`data-tip` + `title` juntos: el bonito para el mouse, el nativo como respaldo.

En móvil la topbar gana `padding-left: 84px` para dejarle lugar al FAB de menú, el
spacer desaparece y los controles se agrupan a la derecha.

### 4.4 El drawer (móvil): el **mismo** `<aside>`, otro modo

```css
@media (max-width: 760px) {
  .app-nav {
    width: 280px; max-width: 84vw; overflow-y: auto;
    padding: var(--ds-space-5) var(--ds-space-4);
    transform: translateX(-100%);
  }
  .app-shell.is-ready .app-nav { transition: transform .28s cubic-bezier(.34,1.2,.5,1); }
  .app-nav.is-open { transform: translateX(0); box-shadow: var(--ds-shadow-03-big); }
  /* Sin empuje: el contenido va a ancho completo */
  .app-content, .topbar { margin-left: 0; }
  /* Textos siempre visibles, ítems alineados a la izquierda */
  .app-nav__label { max-width: none; opacity: 1; }
  .app-nav__item { justify-content: flex-start; padding: 0 16px; gap: var(--ds-space-3); }
  .app-nav__burger { display: none; }   /* en móvil manda la X, no la hamburguesa */
  .app-nav__close  { display: inline-flex; }
  .app-shell.nav-open .app-nav-overlay {
    display: block; position: fixed; inset: 0; z-index: 55; background: rgba(0,0,0,.5);
  }
}
```

No hay dos componentes de navegación: hay **uno con dos modos**. En desktop es riel; a
≤760px es drawer off-canvas con overlay. En JS:

```tsx
<nav className={`app-nav${navOpen ? " is-open" : ""}`} aria-label="Secciones"
     role={navOpen ? "dialog" : undefined} aria-modal={navOpen ? true : undefined}>
```

Solo cuando está abierto en móvil es un diálogo modal. En desktop el mismo elemento es
navegación normal, no modal. Además: **se cierra solo al navegar** (efecto sobre
`pathname`) y con Escape.

### 4.5 Los FABs

```css
.fab { position: fixed; }
.fab--menu   { top: var(--ds-space-4); left: var(--ds-space-5); z-index: 51; border-radius: 50%; }
.fab--action { bottom: var(--ds-space-6); right: var(--ds-space-6); z-index: 44;
               box-shadow: var(--ds-shadow-03-big); }
@media (min-width: 761px) { .fab--menu { display: none; } }
```

- **FAB de menú** (arriba-izquierda, círculo negro, solo móvil). Abre el drawer. Lleva el
  **mismo punto rojo** que el ítem del menú, porque con el drawer cerrado ese ítem no se
  ve. Y solo suma avisos de las secciones que **ese rol tiene**: si no, Bodega vería un
  punto que no lleva a ninguna parte.
- **FAB de acción** (abajo-derecha) — la acción principal del rol, sacada de
  `ROLE_META.action`. Se **esconde** en su propia pantalla, en flujos de creación/edición
  y en la vista de impresión (ahí se montaba encima del documento del proveedor).
- Los dos son `.ds-btn` de verdad, con sus variantes: un FAB no es un botón aparte.
- Cuando el FAB está visible, el contenido reserva espacio abajo
  (`.app-content.has-fab { padding-bottom: 92px }`) para que la última fila no quede
  tapada al llegar al fondo del scroll.

### 4.6 La barra de acciones fija al pie

Aparece cuando hay una selección (“3 líneas seleccionadas — Armar orden”).

```css
.action-bar {
  position: fixed; left: 72px; right: 0; bottom: 0; z-index: 45;
  background: var(--ds-surface); border-top: 1px solid var(--ds-color-gray-100);
  box-shadow: var(--ds-shadow-bar);           /* sombra HACIA ARRIBA */
  padding: var(--ds-space-3) var(--ds-space-6);
  animation: barUp .2s ease;
  transition: left .26s cubic-bezier(.34,1.2,.5,1);   /* sigue al riel */
}
.app-shell.pinned .action-bar { left: var(--nav-w); }
@keyframes barUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

@media (max-width: 760px) {
  .action-bar, .app-shell.pinned .action-bar { left: 0; padding: var(--ds-space-3) var(--ds-space-4); }
  .action-bar__cta { flex-wrap: wrap; width: 100%; }
  .action-bar__cta > .ds-btn { flex: 1 1 100%; }   /* CTAs apiladas a ancho completo */
}
```

Tres detalles: la barra **sigue al riel** (su `left` se anima igual), tiene su **propia
sombra hacia arriba**, y la página que la usa agrega `.is-con-barra`
(`padding-bottom: 120px`) para que las últimas filas no queden debajo.

### 4.7 Orden del z-index (escribilo una vez y respetalo)

| Capa | z-index |
|---|---|
| Celda pegada de tabla (`td.ds-col-fija`) | 1 |
| Encabezado de tabla pegado | 3 |
| FAB de acción | 44 |
| Barra de acciones | 45 |
| Topbar | 50 |
| FAB de menú | 51 |
| Overlay del drawer | 55 |
| Riel / drawer | 60 |
| Overlay del `Select` | 89 · su menú 90 |
| Overlay del modal | 80 · el modal encima |
| Toasts | 100 |
| Skip link | 200 |

### 4.8 Otras navegaciones menores

- `.segmented` — control segmentado (“Tabla | Grid”), píldora gris con el activo en
  superficie + sombra suave.
- `.filter-chip` — filtro de estado con contador. **Activo = negro sólido + texto
  blanco** (no verde). En oscuro se remapea a gris-500, porque el negro sobre la
  superficie oscura contrasta 1,37:1 y el chip “prendido” se volvía invisible.
- `.topnav` — pestañas horizontales; activa en verde con texto negro. En móvil bajan a
  una segunda fila con scroll horizontal, **nunca se ocultan**.
- `.chip-link` — un chip que navega. Tiene la forma de la etiqueta de al lado para no
  romper el ritmo de la tabla, pero se tiñe y subraya al pasar y lleva una flecha ↗ que
  avisa que te saca de la fila.

---

## 5. La tabla (`components/data-table.tsx`)

TanStack Table headless + CSS propio. La API:

```tsx
<DataTable
  data={ordenes}
  columns={cols}                    // ColumnDef[] de TanStack; cada una con `id`
  tablaKey="ordenes"                // clave de la memoria de estado
  getRowId={(o) => o.id}
  onRowClick={(o) => router.push(`/ordenes/${o.id}`)}
  rowClassName={(o) => o.pendiente ? "row-pending" : ""}
  renderExpanded={(o) => <Lineas orden={o} />}   // opcional: botón ⇕ por fila
  buscarPlaceholder="Buscar por proveedor, N.º…"
  titulo="Órdenes de compra"        // título del export
  loading={cargando}                // skeletons mientras no hay datos
  columnVisibilityInicial={{ interno: false }}
  paginacion={false}                // esta lista NUNCA se pagina
  pageSizeInicial={TODAS_LAS_FILAS}
  resumen={(filas) => `${filas.length} órdenes · ${total(filas)}`}
/>
```

Trae, sin que la pantalla haga nada: buscar en todas las columnas (incluidas las
ocultas), ordenar, **filtro por columna con buscador y casillas**, filtro por **rango de
fechas** con calendario, mostrar/ocultar y **reordenar columnas**, paginación,
**vistas guardadas por usuario** en la base, export a CSV/PDF de **lo filtrado y visible**,
y modo Tabla o Grid.

Lo que vale copiar aunque uses otra tabla:

- **El encabezado es negro** con las esquinas de los extremos redondeadas (12–14px), y
  cada columna es una “pill” con su botón de orden y su botón de filtro. Los **filtros
  nunca van dentro de un `<th>`**: ahí solo va el rótulo.
- **Sombras de scroll sin JS**, con `background-attachment: local`. Aparecen solo del
  lado que tiene contenido escondido:

```css
.ds-table-wrap {
  overflow-x: auto; background-color: var(--ds-surface);
  background-image:
    linear-gradient(to right, var(--ds-surface), transparent 32px),
    linear-gradient(to left,  var(--ds-surface), transparent 32px),
    linear-gradient(to right, color-mix(in srgb, var(--ds-text) 16%, transparent), transparent 14px),
    linear-gradient(to left,  color-mix(in srgb, var(--ds-text) 16%, transparent), transparent 14px);
  background-position: 0 0, 100% 0, 0 0, 100% 0;
  background-repeat: no-repeat;
  background-size: 32px 100%, 32px 100%, 14px 100%, 14px 100%;
  background-attachment: local, local, scroll, scroll;
}
```

  El color sale de `--ds-text` con `color-mix`: una sombra negra sobre superficie oscura
  no se ve.
- **La columna de acción pegada al borde derecho** (`position: sticky; right: 0`) solo en
  las tablas que de verdad desbordan. Se aplica celda por celda y **con poca
  especificidad** (`td.ds-col-fija`), para que los tintes por estado de fila
  (`.row-pending`, `.fila-cargo`) le ganen y la celda herede el color de su fila.
  Ojo: no ponerla en una tabla de filas clickeables — el hover de fila vive en el `<tr>`
  y la celda opaca lo taparía.
- **Qué se recuerda y qué no** (`sessionStorage`, por pantalla y por pestaña):
  - **Sí, toda la sesión:** columnas visibles y su orden, Tabla/Grid, orden de las
    filas, cuántas por página. Eso es *la forma de trabajar* de cada quien.
  - **No, o con vencimiento:** lo que se está *buscando* —la barra de búsqueda, los
    filtros de columna y en qué página va— vence a los **30 min** (o al salir de la
    visita a la pantalla). Los filtros de la **pantalla** (los paneles de arriba, que se
    ven encendidos y por eso esconden mucho menos) duran **4 h**, una jornada. Motivo:
    una búsqueda de hace horas **esconde la lista entera sin que se note** — “abrí
    Órdenes y veo 5 de 465” porque la barra traía el proveedor buscado el viernes.
- **Volver a la fila.** Al entrar a un detalle se guarda una marca; al volver, la tabla
  se corre hasta esa fila y la resalta 2,2 s (`tr.is-vuelta`, tinte verde + filo
  izquierdo). En una lista de 200 órdenes, “en qué iba” importa tanto como la página.
- **Gotcha de TanStack:** `autoResetPageIndex` se dispara con **cada cambio del arreglo
  de datos** (acá el refresco cada 45 s), no solo al navegar — la tabla se iba sola a la
  página 1. Hay que apagarlo y manejar el reset a mano.
- **Filas con significado** por clase: `.row-pending` (tinte rojo), `.row-borrador`
  (tinte amarillo + filo izquierdo), `.fila-cargo`, `.fila-cancelada` (texto gris +
  cantidad tachada). Siempre tinte **en el `td`**, no en el `tr`, por la celda pegada.

---

## 6. Catálogo de interacciones

Esto es lo que hace que la app se sienta de una pieza. Va ordenado de más a menos
importante.

| Interacción | Cómo está hecha | Por qué |
|---|---|---|
| **Presionar un botón** | Anillo de color de 8px alrededor (`box-shadow: 0 0 0 8px`). El botón **no se mueve** | Firma del sistema; un botón que salta bajo el dedo se siente inestable |
| **Hover de tarjeta/botón** | La sombra **profundiza** (`shadow-01` → `shadow-03-big`). Cero `translateY` | Elevar por sombra, nunca por desplazamiento |
| **Foco de teclado** | `outline: 3px solid color-mix(green-100 60%)` + `offset: 2px`, solo en `:focus-visible` | No molesta con el mouse, visible con teclado (WCAG 2.4.7) |
| **Baseline de foco** | Una regla con `:where()` (especificidad 0) le da anillo a **cualquier** interactivo que no tenga uno propio | Un control nuevo nace accesible |
| **Vibración** | `haptic.select` (5ms) al presionar, `haptic.delete` ([15,10,15]) en la destructiva, `haptic.complete` al confirmar | Vocabulario **semántico**: se elige por significado, no por “feel”. Solo Android; no-op silencioso en iOS |
| **Entrada de página** | `.page { animation: ds-reveal-in .32s }` → opacidad + 8px de subida | Un solo movimiento, al entrar |
| **Barra de acciones** | `@keyframes barUp` (sube desde abajo, .2s) | La barra “llega”, no aparece |
| **Chevron que despliega** | `transform: rotate(180deg)` con `cubic-bezier(.34, 1.4, .5, 1)` (rebote leve) | La única curva con rebote de la app |
| **Toast** | Sube 8px con opacidad; la **duración depende del largo del texto** | Ver §3.6 |
| **Movimiento reducido** | Una red global **al final del CSS** que baja toda animación y transición a 0.01ms | Había 11 bloques `@media` sueltos y cada animación nueva nacía sin guard |
| **Objetivos táctiles** | Un bloque `@media (pointer: coarse)` **al final** sube `.kebab` e `.icon-btn` a 44px | Va por **puntero**, no por ancho: el mouse conserva los controles compactos. Y va al final porque un `@media` no suma especificidad y perdía contra la definición del componente |

Otras que valen la pena:

- **Skip link** (`Saltar al contenido`) como primer elemento enfocable, escondido con
  `translateY(-160%)` hasta que recibe foco.
- **Estado de guardado local.** Los formularios largos guardan borrador en
  `localStorage` y lo rescatan: la conectividad en obra es intermitente.
- **Guards contra doble envío** en todo lo que escribe: el `loading` del botón lo deja
  inerte solo. Un doble clic creaba dos documentos reales en el ERP.
- **Las acciones de fila no son botones `sm`.** Para eso están `.icon-btn` (36px, fondo
  en hover) y `.kebab` (menú de tres puntos). Un `Button size="sm"` por fila llena la
  tabla de píldoras blancas con sombra.
- **`.link-btn`** para las acciones que se leen como link: verde de texto
  (`green-300`, el que pasa AA), **subraya en hover** (un link sin hover no se lee como
  link) y anillo de foco propio.

---

## 7. Responsive

Breakpoints reales, no una escala inventada:

| Corte | Qué cambia |
|---|---|
| `max-width: 860px` | Login pasa de dos columnas a una (se esconde el panel de marca) |
| `max-width: 760px` | **El corte principal**: riel → drawer, FAB de menú, grids a una columna, tiles a 2, barra de acciones a ancho completo |
| `max-width: 640px` | Heading con `clamp`, calendario de un solo mes, utilidades `.hide-mobile` |
| `pointer: coarse` | Objetivos táctiles a 44px (independiente del ancho) |
| `container-type: inline-size` | En layouts master-detail, **el ancho lo decide el contenedor, no la ventana** — con el riel fijado, una laptop de 1180px le dejaba 570px a una tabla de 6 columnas, y un `max-width` de ventana ni se entera |

**Mobile-first donde importa, no en todas partes.** Las pantallas de Bodega (recepción,
registro de factura) se diseñaron primero para celular —tarjetas compactas, campo de
cantidad directo sin `+`/`−`, acciones secundarias en un kebab— y el escritorio quedó
intacto. Las de Proveeduría son de escritorio con muchas columnas. Forzar una sola
filosofía en las dos habría empeorado las dos.

Patrón para tablas densas en móvil: **la fila se reordena, no se duplica**. Nada de
renderizar dos veces el dato con `.hide-mobile` / `.only-mobile`, porque tarde o temprano
un dato aparece dos veces entre dos breakpoints. Se usa `grid-area` para recolocar:

```css
@media (max-width: 800px) {
  .addl-line { grid-template-columns: minmax(0, 1fr) 84px; row-gap: 2px; }
  .addl-line > .rec-line__desc { grid-area: 1 / 1 / 2 / 2; }
  .addl-line__dest             { grid-area: 2 / 1 / 3 / 2; }
  .addl-line > .rec-line__qty  { grid-area: 3 / 1 / 4 / 2; text-align: left; }
  .addl-line__acc              { grid-area: 1 / 2 / 4 / 3; }  /* acción a la derecha, centrada */
  .addl-line--head { display: none; }   /* sin encabezado: el rótulo se mete en la celda */
}
```

---

## 8. Estado, datos y frescura

Un solo Context (`lib/store.tsx`) expone datos + acciones + **el estado de la conexión**:

```ts
const { pedidos, ordenes, recepciones,        // datos
        cargando, errorCarga, ultimaSync,     // estado de carga
        datosDeCache, modoApi, sesionExpirada,
        recargar } = useStore();
```

Patrones que vale la pena copiar:

1. **Un solo endpoint de arranque** (`/api/bootstrap`) que trae todo de una.
2. **ETag + 304.** El server calcula una huella de exactamente lo que iba a enviar; si el
   cliente manda `If-None-Match` y coincide, contesta 304 **sin cuerpo**. Con la app
   abierta 8 horas, eso es la diferencia entre bajar y volver a parsear todo cada 45 s o
   no bajar nada.
3. **Caché en el navegador** con el ETag guardado junto al cuerpo: al abrir la app se
   pinta lo último que cargó bien (y la barra dice de cuándo es) mientras el primer viaje
   ya puede contestar 304. **Se borra al cerrar sesión**: el que abra después no tiene
   por qué ver los datos de quien salió.
4. **Refresco automático cada 45 s y al volver a la pestaña.**
5. **El error de carga se muestra**, con un callout que dice qué se está viendo:
   *“Estás viendo lo último que cargó bien (hace 4 min)”* o *“Todavía no se pudieron
   traer los datos, así que esta pantalla está vacía: no es que no haya nada”*. Nunca una
   pantalla vacía silenciosa.
6. **Modo prueba sin base**: datos en memoria + `localStorage`. La app corre completa sin
   backend, y los caminos de error degradan con avisos en pantalla.

---

## 9. Accesibilidad — el checklist que de verdad se aplicó

- Skip link como primer foco.
- `:focus-visible` en **todo** control custom, más el baseline con `:where()`.
- `Field` asocia label ↔ input solo.
- Modal: trampa de foco + Escape + restaurar foco + `aria-modal` + `aria-labelledby` +
  scroll del fondo bloqueado.
- Dropdowns con `role="listbox"` / `option` / `aria-selected` / `aria-expanded`, y
  teclado completo (↓ ↑ Enter Escape Tab).
- Toasts con `role="alert"` + `aria-live="assertive"` para errores, `status`/`polite`
  para el resto.
- El **color nunca es el único portador de significado**: el badge lleva punto, el estado
  lleva texto, el punto de aviso del menú lleva su conteo en el `aria-label`.
- Íconos decorativos con `aria-hidden="true"` + `focusable="false"`; el significado lo
  da el texto o el `aria-label` del control.
- `aria-current="page"` en el ítem de menú activo; `aria-pressed` en los toggles.
- Verde de **texto** aparte del verde de **relleno** (`green-300` vs `green-100`), porque
  el de marca sobre blanco no pasa AA.
- `prefers-reduced-motion` cubierto globalmente.

---

## 10. Voz y textos

Parte del diseño, no un detalle:

- Español de Costa Rica, segunda persona, **vocabulario del oficio** (solicitud, orden,
  recepción, obra, partida, insumo), no de software.
- Los errores dicen **qué pasó y qué hacer**, con el dato concreto: número de documento,
  proveedor, línea. Nada de “¡Ups!” ni “Algo salió mal”. Si el sistema externo rechazó
  algo, se dice **por qué lo rechazó él**.
- Los rótulos dicen la unidad y el supuesto: “Totales **sin IVA**”, “del **año en
  curso**”, “contra el **mismo período** del año pasado”.
- La ayuda ⓘ existe porque tres personas distintas usan la app sin capacitación formal.

---

## 11. Lo que NO se hace (y por qué)

- **Ningún color literal** (`#fff`, `white`, `black`, `rgb()`) en TSX ni en CSS nuevo.
  Rompe el tema oscuro en silencio.
- **Ni Tailwind, ni shadcn/ui, ni CSS-in-JS, ni librería de UI o de íconos.** CSS plano
  con tokens, a propósito: el sistema visual es el dueño, no el framework.
- **Sin gradientes decorativos, glassmorphism, sombras de colores, tarjetas dentro de
  tarjetas**, ni el cuadrito de ícono redondeado sobre cada título.
- **Sin hover-lift, y sin hover que cambie la sombra.** La sombra es fija: marca qué
  tipo de superficie es algo, no en qué estado está. El hover cambia color; el presionado
  es el anillo de 8 px; el estado es un borde parejo de 2 px (y el campo pierde la sombra).
- **Sin halos translúcidos** (`box-shadow: 0 0 0 3px color-mix(...)`) para foco ni para
  "seleccionado". Foco = `outline: 2px solid` + `outline-offset`. Seleccionado = borde de
  2 px. Y el borde ya va en 2 px **en reposo** (transparente o gris) para que al activarse
  solo cambie de color y nada se corra de lugar.
- **Sin barras de acento al costado** (`border-left: 4px solid <color>`, o su versión con
  `inset`). Un aviso se separa con **color plano**: tinte de fondo + ícono y título en el
  color del estado. Un bloque dentro de una tarjeta blanca se separa con **relleno**
  gray-100, no con contorno ni sombra.
- **Solo dos grosores de borde:** 1 px para separar, 2 px para estado. Nada de 1,5 px.
- **Sin animar por decorar.** Esta gente pasa el día acá: movimiento solo donde aclara un
  cambio de estado.
- **Sin pesos ni tamaños fuera de la escala.** Escribir `font-weight: 800` cuando la
  fuente no lo trae solo le miente a quien lea el CSS.
- **Sin filtros dentro de un `<th>`**, sin `Button size="sm"` como control de fila, sin
  copias locales de un primitivo.

---

## 12. Si querés arrancar tu app con esto

Orden recomendado, del más rentable al menos:

1. **Copiá el bloque `:root` + `[data-theme="dark"]`** y cambiá los valores por los de tu
   marca. Mantené la **estructura** (primitiva vs. semántica, rampa invertida): es el 80 %
   del beneficio.
2. **Copiá el script anti-parpadeo** del `<head>` y el `data-theme` en `<html>`.
3. **Copiá `ui.tsx` entero** y borrá lo que no uses. Cada primitivo es independiente
   salvo `ConfirmDialog` (usa `Modal`) y `Button` (usa `haptic`).
4. **Copiá el `AppShell`** y cambiá `ROLE_META` por tu tabla de navegación. Si tu app no
   tiene roles, es un solo objeto con `nav` y `action`.
5. **Copiá las clases del chasis** de `globals.css`: `.app-shell`, `.topbar`, `.app-nav*`,
   `.fab*`, `.action-bar`, `.page`, `.modal*`, `.toast*`, `.skip-link`, y las dos redes de
   seguridad del final (`prefers-reduced-motion` y `pointer: coarse`).
6. **Escribí la tabla de z-index** de tu app antes de necesitarla.
7. Recién después, las pantallas.

Y tres hábitos que sostienen todo:

- **Verificar en claro y en oscuro antes de dar algo por terminado.** Un literal se cuela
  y nadie se entera hasta que alguien abre la app de noche.
- **Comentar el porqué en el CSS**, sobre todo lo que parece raro. Cada bloque raro de
  este archivo evita que alguien lo “arregle” y reviva el bug.
- **Si falta una variante, se agrega al primitivo**, nunca una copia local. El día que
  cambie el sistema visual, se cambia en un lugar.

---

*Compras Adelante · Adelante Desarrollos. Este documento describe la capa de UI; el
sistema visual de origen es el Adelante Design System.*
