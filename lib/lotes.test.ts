// La carga inicial viene por tandas y acá se prueba lo único que puede perder datos
// en silencio: el cursor (qué se pide en la vuelta siguiente) y la unión (cómo se
// pega la tanda a lo que ya está). Un error acá no rompe la pantalla — se salta cien
// órdenes sin que nadie se entere, que es peor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cursorDe, siguienteCursor, tamañoDeLote, unirPorId, LOTE_DEFECTO, LOTE_MAX } from "./lotes.ts";

const docs = (...ids: number[]) => ids.map((id) => ({ id: String(id) }));

// ---- CUÁNTOS POR VUELTA -------------------------------------------------------
test("lote: sin el parámetro no se pagina (es la carga completa de siempre)", () => {
  assert.equal(tamañoDeLote(null), null);
});

test("lote: basura en la URL cae al tamaño de siempre, no a cero ni a NaN", () => {
  // Un 0 o un "abc" que pasara tal cual sería un TOP (0): la pantalla vacía para
  // siempre y el cliente pidiendo vueltas sin fin.
  assert.equal(tamañoDeLote("0"), LOTE_DEFECTO);
  assert.equal(tamañoDeLote("-5"), LOTE_DEFECTO);
  assert.equal(tamañoDeLote("abc"), LOTE_DEFECTO);
  assert.equal(tamañoDeLote(""), LOTE_DEFECTO);
});

test("lote: nadie se pide la historia entera por la URL", () => {
  assert.equal(tamañoDeLote("999999"), LOTE_MAX);
  assert.equal(tamañoDeLote("150"), 150);
  assert.equal(tamañoDeLote("150.9"), 150);   // se trunca, no se redondea
});

// ---- EL CURSOR ----------------------------------------------------------------
test("cursor: solo un id positivo cuenta", () => {
  assert.equal(cursorDe("805"), 805);
  assert.equal(cursorDe(null), null);
  assert.equal(cursorDe("0"), null);
  assert.equal(cursorDe("-3"), null);
  assert.equal(cursorDe("hola"), null);
});

test("cursor: la vuelta siguiente arranca en el id más chico del lote", () => {
  // Vienen ordenados de nuevo a viejo, pero el cursor NO confía en el orden.
  assert.equal(siguienteCursor(docs(810, 809, 808), 3), 808);
  assert.equal(siguienteCursor(docs(808, 810, 809), 3), 808);
});

test("cursor: si vinieron menos de los pedidos, esta entidad ya se terminó", () => {
  assert.equal(siguienteCursor(docs(810, 809), 3), null);
  assert.equal(siguienteCursor([], 3), null);
});

test("cursor: con el lote justo se pide una vuelta más (y esa vuelve vacía)", () => {
  // Es a propósito: saber que no queda nada costaría un COUNT por vuelta. Un viaje
  // de más vale menos que una consulta de más en cada tanda.
  assert.equal(siguienteCursor(docs(3, 2, 1), 3), 1);
  assert.equal(siguienteCursor([], 3), null);
});

// ---- PEGAR LA TANDA -----------------------------------------------------------
test("unir: la tanda nueva se agrega al final, en su orden", () => {
  assert.deepEqual(unirPorId(docs(810, 809), docs(808, 807)), docs(810, 809, 808, 807));
});

test("unir: lo que ya estaba NO se duplica", () => {
  // Pasa si el refresco de 45 s trae la historia completa en medio de la tanda.
  assert.deepEqual(unirPorId(docs(810, 809, 808), docs(809, 808, 807)), docs(810, 809, 808, 807));
});

test("unir: una tanda vacía devuelve EL MISMO arreglo (no re-renderiza de gusto)", () => {
  const viejas = docs(810, 809);
  assert.equal(unirPorId(viejas, []), viejas);
  assert.equal(unirPorId(viejas, docs(810)), viejas);   // todo repetido: tampoco
});

test("unir: la versión que ya estaba gana sobre la que llega repetida", () => {
  // La del refresco es más nueva que la del lote: pisarla con la vieja sería
  // retroceder justo lo que se acaba de confirmar con el servidor.
  const viejas = [{ id: "810", estado: "lanzado" }];
  const nuevas = [{ id: "810", estado: "abierto" }];
  assert.deepEqual(unirPorId(viejas, nuevas), [{ id: "810", estado: "lanzado" }]);
});

// ---- LA VUELTA COMPLETA -------------------------------------------------------
// El cursor lo calcula el servidor y la unión la hace el cliente: cada mitad por
// separado puede estar bien y juntas perder documentos igual. Acá se simula la
// paginación de verdad —"los N vivos más nuevos por debajo del cursor"— contra la
// misma lista que devolvería SQL, y se exige lo único que importa: que al final esté
// TODO, una sola vez.
function paginar(todas: Array<{ id: string }>, antes: number | null, n: number) {
  return todas
    .filter((d) => antes == null || Number(d.id) < antes)   // el "AND id < @antes"
    .sort((a, b) => Number(b.id) - Number(a.id))            // el "ORDER BY id DESC"
    .slice(0, n);                                           // el "TOP (@lim)"
}

function recorrer(todas: Array<{ id: string }>, n: number, entreVueltas?: (v: number) => void) {
  let cursor: number | null = null;
  let acumulado: Array<{ id: string }> = [];
  let vueltas = 0;
  for (let i = 0; i < 100; i++) {
    const lote = paginar(todas, cursor, n);
    acumulado = unirPorId(acumulado, lote);
    vueltas++;
    cursor = siguienteCursor(lote, n);
    if (cursor == null) break;
    entreVueltas?.(vueltas);
  }
  return { acumulado, vueltas };
}

test("tandas: 787 órdenes en lotes de 150 llegan todas, una sola vez", () => {
  const todas = Array.from({ length: 787 }, (_, i) => ({ id: String(787 - i) }));
  const { acumulado, vueltas } = recorrer(todas, 150);
  assert.equal(acumulado.length, 787);
  assert.equal(new Set(acumulado.map((d) => d.id)).size, 787);
  assert.equal(vueltas, 6);   // 5 llenas + la última de 37
  // Y en el orden en que las pinta la pantalla: de la más nueva a la más vieja.
  assert.equal(acumulado[0].id, "787");
  assert.equal(acumulado[acumulado.length - 1].id, "1");
});

test("tandas: justo un múltiplo del lote gasta una vuelta de más y termina bien", () => {
  const todas = Array.from({ length: 300 }, (_, i) => ({ id: String(300 - i) }));
  const { acumulado, vueltas } = recorrer(todas, 150);
  assert.equal(acumulado.length, 300);
  assert.equal(vueltas, 3);   // 150, 150 y una vacía que confirma el final
});

test("tandas: una orden CREADA en medio de la carga no se duplica ni rompe el cursor", () => {
  // Nace con un id más alto que el cursor, así que no entra en las tandas que
  // faltan: la trae el refresco de 45 s. Lo que NO puede pasar es que se repita o
  // que corra a las demás.
  const todas = Array.from({ length: 400 }, (_, i) => ({ id: String(400 - i) }));
  const { acumulado } = recorrer(todas, 150, () => { todas.unshift({ id: "401" }); });
  assert.equal(new Set(acumulado.map((d) => d.id)).size, acumulado.length);
  assert.equal(acumulado.length, 400);
  assert.ok(!acumulado.some((d) => d.id === "401"));
});

test("tandas: una orden BORRADA en medio no deja un hueco en las demás", () => {
  const todas = Array.from({ length: 400 }, (_, i) => ({ id: String(400 - i) }));
  const { acumulado } = recorrer(todas, 150, () => {
    const i = todas.findIndex((d) => d.id === "10");   // una vieja, todavía sin traer
    if (i >= 0) todas.splice(i, 1);
  });
  assert.equal(new Set(acumulado.map((d) => d.id)).size, acumulado.length);
  assert.ok(!acumulado.some((d) => d.id === "10"));    // se fue, y es lo correcto
  assert.equal(acumulado.length, 399);
});

test("tandas: sin nada que traer, una sola vuelta y nada que pintar", () => {
  const { acumulado, vueltas } = recorrer([], 150);
  assert.deepEqual(acumulado, []);
  assert.equal(vueltas, 1);
});
