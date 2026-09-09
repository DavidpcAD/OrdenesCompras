# Compras Adelante — instrucciones del proyecto

App **en producción** de Adelante Desarrollos: órdenes de compra, recepción en bodega y
facturación, integrada con Business Central y SQL Server.

Lee primero, en este orden:

1. [README.md](README.md) — arquitectura, los 3 roles, el flujo completo y la frontera con BC.
2. [PRODUCT.md](PRODUCT.md) — para quién es, en qué contexto se usa, restricciones y voz.
3. [DESIGN.md](DESIGN.md) — el sistema visual (Adelante Design System) y sus tokens.

## Comandos

| Qué | Cómo |
|---|---|
| Levantar en local | Preview del agente con la config `ordenes-dev` de `.claude/launch.json`. **No** correr `next dev` por Bash. |
| Pruebas | `npm test` (node:test, sin framework externo) |
| Tipos | `npx tsc --noEmit` |
| Build | `npm run build` |

**Gotcha:** correr `npm run build` con el dev server arriba deja el preview en blanco
(`vendor-chunks/next.js`). Se arregla parando el server, `rm -rf .next`, y levantarlo de nuevo.

**Gotcha:** `app/layout.tsx` necesita `export const dynamic = "force-dynamic"`. Sin eso el
front hornea `USE_API` en build y queda en modo mock.

## Reglas duras de UI

Estas no son preferencias, son la diferencia entre que la app se sienta de Adelante o no:

- **Todo color, espacio, radio, sombra y tipografía sale de un token `--ds-*`.** Cero literales
  (`#fff`, `white`, `black`, `rgb(...)`) en TSX o en CSS nuevo.
- **UI nueva usa la capa semántica** (`--ds-bg`, `--ds-surface`, `--ds-surface-2`, `--ds-text`,
  `--ds-tint-base`), que es la que remapea el tema oscuro. `--ds-color-white` / `--ds-color-black`
  quedan para blanco y negro **literales de marca** (texto sobre botón de color, encabezado de
  tabla, checkmarks, toasts).
- **Verificar en claro y en oscuro** antes de dar algo por terminado. Un literal rompe el oscuro
  en silencio.
- **Reutilizar los primitivos de [`components/ui.tsx`](components/ui.tsx).** Si falta una
  variante, se agrega ahí, no se hace una copia local.
- **Sin Tailwind, sin shadcn/ui, sin CSS-in-JS, sin librerías de UI o de íconos.** CSS plano con
  tokens, a propósito. Los íconos salen de [`components/ds-icon.tsx`](components/ds-icon.tsx).
- Español de Costa Rica, vocabulario del oficio. Los errores dicen qué pasó y qué hacer, con el
  dato concreto.

## Las skills de diseño instaladas

En `.claude/skills/` hay skills de diseño de terceros (`impeccable`, las de Emil Kowalski,
`design-taste-frontend`, `ui-ux-pro-max`, `playwright-cli`). Sirven para **auditar, criticar y
refinar**. Antes de usarlas:

- **El DS le gana a la skill.** Cualquier paleta, tipografía, escala o "mundo visual" que traiga
  una skill se ignora: la verdad visual es [DESIGN.md](DESIGN.md), y su origen es el DS en
  `davidpcad.github.io/adelante-design-system`.
- **Esto es refinamiento, nunca redesign.** El modo correcto en el vocabulario de impeccable es
  **Operate** (herramienta de trabajo), no Persuade. Las sub-skills útiles son `audit`,
  `critique`, `polish`, `harden`, `clarify`, `distill`, `optimize`. Las de `bolder`, `delight`,
  `colorize` y `overdrive` casi nunca aplican acá y **nunca** sin pedirlo explícitamente.
- Las skills de branding, generación de imágenes, landing pages, brutalismo o GSAP **no se
  instalaron a propósito**. Si aparece una sugerencia de esas, es ruido.
- Ninguna skill autoriza `git push`, tocar BC, ni correr migraciones SQL.

`.claude/` está en `.gitignore`: las skills son locales de cada máquina. Para reinstalarlas ver
[docs/skills-de-diseno.md](docs/skills-de-diseno.md).

## Cosas que no se hacen sin preguntar

- `git push` a `main` (dispara deploy a Azure por GitHub Actions).
- Correr migraciones SQL. Los scripts van a `sql/`, idempotentes, y **los corre David**.
- Escribir en BC desde una prueba.
- Sembrar datos de demo en modo API.
