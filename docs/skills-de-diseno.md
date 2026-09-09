# Skills de diseño (cómo reinstalarlas)

`.claude/` está en `.gitignore`, así que las skills **no viajan en el repo**: cada máquina las
instala. Esto es lo que hay instalado y con qué comando volver a ponerlo.

Las barandas de cómo deben comportarse acá están en [../CLAUDE.md](../CLAUDE.md).
La verdad visual que leen está en [../DESIGN.md](../DESIGN.md) y [../PRODUCT.md](../PRODUCT.md).

## impeccable — auditoría y refinamiento con detectores deterministas

Skill principal, 23 sub-comandos y 61 reglas de detección que corren **sin LLM**.

```bash
npx impeccable install -y --project --providers=claude-code
```

Uso: `/impeccable audit <ruta>`, `/impeccable critique <ruta>`, `/impeccable polish <ruta>`.
El modo de esta app es **Operate**. Instala además 4 subagentes en `.claude/agents/`.

## Emil Kowalski — criterio de animación y detalle

```bash
npx skills@latest add emilkowalski/skills -a claude-code --copy -y -s "emil-design-eng"
```

Instaladas: `emil-design-eng`, `animate`, `review-animations`, `improve-animations`,
`find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `prototype`,
`pick-ui-library` (una por comando, cambiando el `-s`).

Fuera: `animate-expo` y `write-swift` (no hay app nativa), `ask-sonner` (no se usa Sonner).

## taste-skill — anti-slop

```bash
npx skills@latest add Leonxlnx/taste-skill -a claude-code --copy -y -s "design-taste-frontend"
npx skills@latest add Leonxlnx/taste-skill -a claude-code --copy -y -s "redesign-existing-projects"
```

Fuera a propósito: `brandkit`, `industrial-brutalist-ui`, `minimalist-ui`, `gpt-taste`,
`image-to-code`, `imagegen-frontend-web`, `imagegen-frontend-mobile`, `stitch-design-taste`.
Todas imponen una estética propia (o generan imágenes) y pelean con el Adelante DS.

## ui-ux-pro-max — datos de UX consultables

```bash
npx skills@latest add nextlevelbuilder/ui-ux-pro-max-skill -a claude-code --copy -y -s "ui-ux-pro-max"
npx skills@latest add nextlevelbuilder/ui-ux-pro-max-skill -a claude-code --copy -y -s "design-system"
```

Trae 119 guías de UX, accesibilidad y layout responsive consultables localmente. Útil como
referencia; su paleta y sus recomendaciones de stack (shadcn/Tailwind) **no aplican acá**.

Fuera: `ui-styling` (shadcn + Tailwind), `banner-design`, `brand`, `design`, `slides`.

## playwright-cli — verificación en navegador

```bash
npm i -D @playwright/cli
npx playwright-cli install --skills
```

Agrega `.claude/skills/playwright-cli` (correr y depurar tests, mock de red, sesiones, storage
state, generación y reparación de tests, traces, video). Su salida va a `.playwright-cli/`, que
ya está en `.gitignore` porque puede contener credenciales.

## ui-skills.com — registro de skills (opcional)

No es una skill: es un catálogo. Se consulta sin instalar nada:

```bash
npx ui-skills list --category motion
npx ui-skills get baseline-ui
```

También expone un MCP en `https://www.ui-skills.com/mcp` (tools `list_skills`, `get_skill`).
Si se quiere conectar, se agrega a la config de MCP en una sesión interactiva.
