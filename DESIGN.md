---
name: Compras Adelante
description: App interna de órdenes de compra, recepción y facturación de Adelante Desarrollos, sobre el Adelante Design System.
colors:
  white: "#fff"
  black: "#000"
  surface: "#f3f3f3"
  gray-100: "#ebebeb"
  gray-200: "#d9d9d9"
  gray-300: "#aaafb6"
  gray-400: "#747b86"
  gray-500: "#5d636c"
  yellow: "#f0c802"
  green-100: "#add010"
  green-200: "#88a024"
  green-300: "#5f7a1a"
  red-100: "#c96c6c"
  red-200: "#bb4a4a"
  bg: "{colors.surface}"
  text: "{colors.black}"
  dark-bg: "#16181d"
  dark-surface: "#212530"
  dark-surface-2: "#262b36"
  dark-text: "#e8eaed"
  nav-bg: "#2a2a2a"
typography:
  heading:
    fontFamily: "Roboto, 'Segoe UI', sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "40px"
    letterSpacing: "0"
  subtitle-lg:
    fontFamily: "Roboto, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "24px"
  subtitle:
    fontFamily: "Roboto, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "Roboto, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "Roboto, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  body-sm:
    fontFamily: "Roboto, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  sm: "4px"
  md: "8px"
  card: "12px"
  lg: "16px"
  xl: "32px"
  full: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  10: "40px"
components:
  button-primary:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "16px"
    height: "56px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
    height: "56px"
  button-confirm:
    backgroundColor: "{colors.green-100}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    height: "56px"
  button-destructive:
    backgroundColor: "{colors.red-100}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    height: "56px"
  button-sm:
    rounded: "{rounded.xl}"
    padding: "8px 16px"
    height: "44px"
    typography: "{typography.body-sm}"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "{spacing.6}"
  badge:
    rounded: "999px"
    padding: "4px 12px"
    typography: "{typography.body-sm}"
  table-header:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    rounded: "12px"
---

## Overview

**Modo: Operate.** Esta es una herramienta de trabajo interna que usan tres personas
concretas (Angie en proveeduría, Pedro en bodega, Kattya en contabilidad) durante toda su
jornada, muchas veces desde el celular y en obra. El éxito es que completen la tarea sin
equivocarse, no que la pantalla impresione. Escaneabilidad, consistencia y densidad de
información le ganan a la expresión visual. La marca vive en el detalle preciso.

El sistema visual es el **Adelante Design System**, replicado en
[`app/globals.css`](app/globals.css) desde `https://davidpcad.github.io/adelante-design-system`.
**El DS es el origen de la verdad y no se rediseña desde esta app.** Cualquier trabajo de
diseño acá es *refinamiento* (preserva la identidad), nunca *redesign* (reemplazo del mundo
visual). Si algo se siente incorrecto y la causa es el DS, se reporta — no se parcha local.

## Colors

Dos capas, y la distinción importa:

- **Capa primitiva de marca** — `--ds-color-*`. Rampa de grises, amarillo, verdes, rojos, y
  `--ds-color-white` / `--ds-color-black`, que son blanco y negro **literales de marca**: texto
  sobre un botón de color, encabezado de tabla, checkmarks, toasts. Estos **no** cambian con el
  tema.
- **Capa semántica de superficie** — `--ds-bg` (fondo de página), `--ds-surface` (tarjetas,
  inputs, popovers, topbar), `--ds-surface-2` (elevada), `--ds-text` (texto del cuerpo),
  `--ds-tint-base` (base de los `color-mix` sutiles). **Toda UI nueva usa esta capa**, porque es
  la que el tema oscuro remapea.

Un tercer valor vive aparte: `--ds-nav-bg` (la columna oscura del riel de navegación).
Es oscura en los **dos** temas, así que se define una sola vez y no se remapea.

El tema oscuro se activa con `<html data-theme="dark">` e invierte la rampa de grises
(100 = relleno más oscuro … 500 = texto más claro) además de redefinir superficies y sombras.
Un color escrito a mano rompe el modo oscuro en silencio.

Semántica de estado: `--st-open`, `--st-launched`, `--st-pending`, `--st-partial`, `--st-done`.
El color nunca es el único portador del significado: siempre va con texto o ícono.

## Typography

Una sola familia: **Roboto**, cargada por `<link>` de Google Fonts en
[`app/layout.tsx`](app/layout.tsx) con los pesos **400, 500, 600 y 700**.

Los tokens del DS solo nombran dos: `--ds-font-weight-regular` (400) y
`--ds-font-weight-semibold` (600). Esos son los que usa el texto de la interfaz. El **700**
está cargado y se usa a propósito en etiquetas chiquitas en mayúsculas, badges, avatares y
el titular del login. **El 800 y el 900 no existen**: Roboto no los trae acá y el navegador
los resuelve a 700 sin diferencia visible (medido: mismo ancho al pixel). Escribir 800 no
hace nada más que mentirle a quien lea el CSS.

Escala fija de seis pasos: `.ds-heading` (32/40) · `.ds-subtitle-lg` (24/24) ·
`.ds-subtitle` (20/24) · body (16/24) · `.ds-label` (14/20) · `.ds-body-sm` (12/16).
Los números tabulares van con `.ds-num` (alineado a la derecha).

**Excepciones documentadas**, que el detector no debe volver a marcar:

- El **login** es la única superficie con titular de escaparate: `clamp(40px, 6vw, 66px)`.
  Es la única pantalla que no es Operate, y se deja así a propósito.
- Las **páginas de impresión** (`ordenes/[id]/imprimir`, `pedidas`) y la ventana de
  exportación de `DataTable` usan su propio stack (`"Segoe UI", Roboto, system-ui`) y una
  escala en puntos de papel (10.5–26px). Son documentos aparte: no ven las variables CSS y
  su salida se compara contra los documentos de BC. No se normalizan a la rampa de pantalla.
- Etiquetas de sección en mayúsculas a 11px con `letter-spacing` (`.help-sec__h`,
  `.combo__group`, `.app-nav__section`) son un paso deliberado por debajo de `body-sm`.

**No migrar Roboto a `next/font`**: el paquete estático no trae el peso 600 que el DS usa y el
build falla. Queda con el `<link>` a propósito.

## Layout

Ancho de contenido con `.page` y `.page--wide`. La navegación es un sidebar oscuro con riel
colapsable (expandir/fijar persistente) y una topbar; en móvil el sidebar es un drawer modal
(`role="dialog"` + `aria-modal`) y la acción principal del rol vive en un FAB abajo a la
derecha.

**Mobile-first donde importa.** Bodega trabaja desde el celular: la pantalla de recepción y
registro de factura se diseñó primero para móvil (tarjetas compactas, campo de cantidad
directo, acciones secundarias en un kebab) y el escritorio quedó intacto. Las tablas densas
colapsan columnas con `.only-mobile-cols`; las barras de acción se fijan al pie con
`.action-bar` y su sombra propia hacia arriba (`--ds-shadow-bar`).

Objetivos táctiles: 56px el control normal, 44px el `--sm`. Eso ya está en los tokens de
botón; no bajar de ahí en controles que se usan con el dedo.

## Elevation & Depth

Elevación por **sombra**, nunca por borde. Tres niveles:
`--ds-shadow-01` (tarjetas, botón `--sm`), `--ds-shadow-02-soft` (botón blanco, superficies
sutiles), `--ds-shadow-03-big` (botones sólidos, elementos que flotan), más `--ds-shadow-bar`
para barras fijas al pie. En oscuro las tres se vuelven más opacas.

El `:active` de un botón no lo mueve: crece un anillo de color de 8px alrededor
(`box-shadow: 0 0 0 8px …`). Es la firma táctil del DS.

## Shapes

`--ds-radius-sm: 4px` · `md: 8px` · `lg: 16px` (el radio por defecto de tarjetas y botones) ·
`xl: 32px` (botón `--sm`, forma de píldora). Los badges son píldora completa (`999px`). El
encabezado de tabla usa 12px en las esquinas de los extremos.

## Components

Los primitivos viven en [`components/ui.tsx`](components/ui.tsx) y **se usan en vez de
reinventarlos**: `Button`, `Card`, `Badge`, `Field`, `Input`, `Textarea`, `Select`, `Checkbox`,
`Modal`, `ConfirmDialog`, `Tile`, `EmptyState`, `Skeleton`, `ProgressBar`, `QtyRing`, `useToast`.
Compuestos: `DataTable`, `Combobox`, `DateField`, `Timeline`, `OrderLines`, `AppShell`.

Reglas de comportamiento que ya se decidieron y no se re-litigan:

- **`.ds-table thead th` es negro para cualquier `th`.** Nunca se ponen filtros ahí dentro.
- **`Button size="sm"` no es un control de fila.** Para acciones dentro de una fila hay
  `.icon-btn` y `.kebab`.
- La lista en grilla ya existe: `.rec-line`. No hacer otra.
- Los filtros de tabla usan `.md-filtro` / `.dt-filter-*`, no `th`.
- `.ds-tip` + `data-tip` solo en la topbar; en el riel colapsado se usa `title` nativo.
- El ícono viene de [`components/ds-icon.tsx`](components/ds-icon.tsx) (set del DS). No se
  agregan íconos de otra familia ni se instalan librerías de íconos.

## Do's and Don'ts

**Do**

- Usar `--ds-*` para todo color, espacio, radio, sombra y tipografía.
- Usar la capa semántica (`--ds-bg`, `--ds-surface`, `--ds-text`, `--ds-tint-base`) en UI nueva,
  y verificar en claro **y** oscuro antes de dar algo por terminado.
- Reutilizar el primitivo de `components/ui.tsx`; si falta una variante, agregarla ahí.
- Escribir en español de Costa Rica, en el vocabulario de la gente que usa la app
  (solicitud, orden, pedido de BC, recepción, nota de crédito, obra, partida, insumo).

**Don't**

- **No** escribir un color literal (`#fff`, `white`, `black`, `rgb(...)`) en TSX ni en CSS nuevo.
- **No** introducir Tailwind, shadcn/ui, CSS-in-JS ni otra librería de UI. El proyecto es CSS
  plano con tokens, a propósito.
- **No** agregar gradientes decorativos, glassmorphism, sombras de colores, tarjetas dentro de
  tarjetas, ni el cuadrito de ícono redondeado sobre cada título. Nada de eso es del DS.
- **No** cambiar la familia tipográfica ni inventar pesos (500, 700) o tamaños fuera de la escala.
- **No** animar por decorar: esta gente pasa el día acá. Movimiento solo donde aclara un cambio
  de estado, y respetando `prefers-reduced-motion`.
- **No** rediseñar el DS desde esta app.
