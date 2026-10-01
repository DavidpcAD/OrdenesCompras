// QUE NINGUNA PANTALLA NUEVA NAZCA SIN GUARDIA.
//
// El middleware es el que exige sesión para entrar. No corre en toda la app: corre
// en las rutas de su `matcher`, que es una lista escrita a mano
// (/proveeduria/:path*, /facturacion/:path*, /api/:path*). Mientras las secciones
// sean esas dos está bien, pero el día que alguien agregue una tercera —una pantalla
// de contabilidad, un panel de administración— la va a poder abrir cualquiera sin
// loguearse, y no hay ningún error que lo delate: la pantalla simplemente carga.
//
// Esta prueba recorre los page.tsx DEL DISCO y exige que el matcher los cubra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// El matcher se lee del archivo como texto: importar middleware.ts arrastraría los
// alias "@/" que el runner de Node no resuelve.
function matcherDelMiddleware(): string[] {
  const src = readFileSync("middleware.ts", "utf8");
  const bloque = /matcher:\s*\[([^\]]+)\]/.exec(src);
  assert.ok(bloque, "no se encontró el matcher en middleware.ts");
  return [...bloque[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

function rutasDelDisco(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "api" || e.name.startsWith("_")) continue;
      out.push(...rutasDelDisco(join(dir, e.name), `${base}/${e.name}`));
    } else if (e.name === "page.tsx") out.push(base || "/");
  }
  return out;
}

// "/proveeduria/:path*" cubre /proveeduria y todo lo que cuelga de ahí.
const cubre = (patron: string, ruta: string) => {
  const base = patron.replace(/\/:path\*$/, "");
  return ruta === base || ruta.startsWith(base + "/");
};

test("toda pantalla de la app pasa por el middleware", () => {
  const matcher = matcherDelMiddleware();
  // "/" es el login: queda afuera a propósito (es donde te manda el middleware).
  const rutas = rutasDelDisco("app").filter((r) => r !== "/");
  assert.ok(rutas.length > 20, `esperaba las pantallas de la app, encontré ${rutas.length}`);

  const sinGuardia = rutas.filter((r) => !matcher.some((p) => cubre(p, r)));
  assert.deepEqual(sinGuardia, [],
    `estas pantallas se pueden abrir sin sesión: ${sinGuardia.join(", ")} — agregalas al matcher de middleware.ts`);
});

test("las rutas de API siguen cubiertas por el matcher", () => {
  const matcher = matcherDelMiddleware();
  assert.ok(matcher.some((p) => cubre(p, "/api/ordenes")), "/api/:path* dejó de cubrir las rutas de API");
});

test("el login NO está en el matcher: es a donde el middleware manda", () => {
  // Si "/" entrara, redirigiría a sí mismo.
  const matcher = matcherDelMiddleware();
  assert.equal(matcher.some((p) => p === "/" || p === "/:path*"), false);
});
