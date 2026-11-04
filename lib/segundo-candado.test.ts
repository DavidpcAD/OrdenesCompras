// QUE NINGUNA RUTA DE API NUEVA NAZCA SIN SEGUNDO CANDADO.
//
// El middleware exige sesión para /api/*, pero en Next < 14.2.25 un header bastaba
// para saltárselo (CVE-2025-29927) y ninguna ruta revisaba la cookie por su cuenta:
// se leían y escribían órdenes sin loguearse. Desde entonces cada handler llama
// `exigirSesion()` (lib/actor.ts) como PRIMERA cosa, antes de leer el body o tocar
// SQL/BC. Esta prueba recorre los route.ts del disco y lo exige.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Las únicas que contestan sin sesión, igual que PUBLIC_API en middleware.ts.
const PUBLICAS = ["app/api/login/route.ts", "app/api/logout/route.ts", "app/api/health/route.ts"];

function rutas(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...rutas(p));
    else if (n === "route.ts") out.push(p);
  }
  return out;
}

test("todo handler de /api exige sesión en su primera línea", () => {
  const archivos = rutas("app/api").filter((f) => !PUBLICAS.includes(f));
  assert.ok(archivos.length > 50, `esperaba las rutas de la API, encontré ${archivos.length}`);

  const sinCandado: string[] = [];
  for (const f of archivos) {
    const lineas = readFileSync(f, "utf8").split("\n");
    lineas.forEach((l, i) => {
      const m = /^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/.exec(l);
      if (!m) return;
      const ok = lineas[i + 1]?.trim() === "const sinSesion = await exigirSesion();"
        && lineas[i + 2]?.trim() === "if (sinSesion) return sinSesion;";
      if (!ok) sinCandado.push(`${f} ${m[1]}`);
    });
  }
  assert.deepEqual(sinCandado, [],
    `estos handlers contestan sin revisar la sesión: ${sinCandado.join(", ")} — ` +
    "poné `const sinSesion = await exigirSesion(); if (sinSesion) return sinSesion;` como primera línea");
});

test("las rutas públicas son las mismas que deja pasar el middleware", () => {
  const src = readFileSync("middleware.ts", "utf8");
  const bloque = /PUBLIC_API\s*=\s*\[([^\]]+)\]/.exec(src);
  assert.ok(bloque, "no se encontró PUBLIC_API en middleware.ts");
  const delMiddleware = [...bloque[1].matchAll(/"([^"]+)"/g)].map((m) => `app${m[1]}/route.ts`).sort();
  assert.deepEqual(delMiddleware, [...PUBLICAS].sort());
});
