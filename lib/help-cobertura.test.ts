// QUE NINGUNA PANTALLA SE QUEDE SIN SU ⓘ.
//
// `helpForPath` termina en un `return GENERIC`, que no explica la pantalla sino la
// app entera. Es la salida correcta para una ruta rara, pero también es donde cae
// una pantalla NUEVA a la que se le olvidó la ayuda: el botón sigue ahí, abre, y
// dice una generalidad. Nadie reporta eso.
//
// Esta prueba recorre las rutas DE VERDAD (los page.tsx del disco, no una lista
// escrita a mano que haya que acordarse de actualizar) y exige que cada una tenga
// la suya. El día que alguien agregue una pantalla sin ayuda, falla acá.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { helpForPath } from "./help.ts";

function rutasDelDisco(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      // Las carpetas de infraestructura no son pantallas.
      if (e.name === "api" || e.name.startsWith("_")) continue;
      out.push(...rutasDelDisco(join(dir, e.name), `${base}/${e.name}`));
    } else if (e.name === "page.tsx") {
      out.push(base || "/");
    }
  }
  return out;
}

// Los segmentos dinámicos se rellenan con un id cualquiera: lo que importa es la
// FORMA de la ruta, que es lo que mira helpForPath.
const concreta = (r: string) => r.replace(/\[[^\]]+\]/g, "123");

const TITULO_GENERICO = "Compras Adelante";

test("toda pantalla de la app tiene su propia ayuda", () => {
  const rutas = rutasDelDisco("app").filter((r) => r !== "/");   // "/" es el login
  assert.ok(rutas.length > 20, `esperaba las pantallas de la app, encontré ${rutas.length}`);

  const sinAyuda = rutas.filter((r) => helpForPath(concreta(r)).titulo === TITULO_GENERICO);
  assert.deepEqual(sinAyuda, [], `estas pantallas caen en la ayuda genérica: ${sinAyuda.join(", ")}`);
});

test("cada ayuda dice qué es la pantalla y cómo usarla", () => {
  for (const r of rutasDelDisco("app").filter((r) => r !== "/")) {
    const h = helpForPath(concreta(r));
    assert.ok(h.titulo.trim(), `${r}: sin título`);
    assert.ok(h.resumen.trim(), `${r}: sin resumen`);
    assert.ok(h.detalle.length > 0, `${r}: sin "para qué sirve"`);
  }
});

test("las cuatro pestañas de Compras tienen ayuda distinta, no la de Resumen", () => {
  // La pantalla es una sola y la ayuda la elige la pestaña: si se cruzan, el ⓘ
  // explica una pestaña que no es la que se está viendo.
  const porVista = ["resumen", "solicitudes", "ordenes", "proveedores"]
    .map((v) => helpForPath("/proveeduria/compras", v).titulo);
  assert.equal(new Set(porVista).size, 4, `se repiten: ${porVista.join(" · ")}`);
});

test("una ruta que no existe sí cae en la ayuda genérica", () => {
  assert.equal(helpForPath("/una/ruta/inventada").titulo, TITULO_GENERICO);
});
