// REPARTO DE UNA LÍNEA DE SOLICITUD ENTRE VARIAS DE LA ORDEN.
//
// La solicitud pide "10 PAR" de un zapato y hay que comprar 2 de la talla 39 y 3 de
// la 42: una fila por variante. Si no se suman TODAS las filas que salen de la misma
// línea, se compra de más sin que nadie lo note.
//
// Y la parte que más fácil se rompe en silencio es la de la UNIDAD: cuando una fila
// cambia la unidad de compra (la solicitud pide 255.000 GR y se compra 1 ESTAÑÓN),
// comparar los números daría un falso "te pasaste del pendiente". Eso se contesta
// `pendiente: null` — "no se puede comparar"— y no con un número inventado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repartoDeLineaSolicitud } from "./helpers.ts";
import type { PedidoLinea } from "./types.ts";

const pl = (o: Partial<PedidoLinea> = {}): PedidoLinea => ({
  id: "pl1", articuloId: "M01-0001", descripcion: "Zapato", cantidad: 10,
  unidad: "PAR", cantidadOrdenada: 0, ...o,
} as PedidoLinea);

test("suma todas las variantes que salen de la misma línea", () => {
  const r = repartoDeLineaSolicitud(
    [{ cantidad: 2, unidad: "PAR" }, { cantidad: 3, unidad: "PAR" }],
    pl({ cantidad: 10, cantidadOrdenada: 0 }),
  );
  assert.equal(r.total, 5);
  assert.equal(r.pendiente, 10);
  assert.equal(r.unidad, "PAR");
});

test("las cantidades llegan como texto del input y se suman igual", () => {
  // Las filas vienen de <input type="number">, así que `value` es siempre un número
  // con punto (el navegador normaliza) o "" si está vacío o a medio escribir.
  const r = repartoDeLineaSolicitud([{ cantidad: "2.5", unidad: "PAR" }, { cantidad: "3", unidad: "PAR" }], pl());
  assert.equal(r.total, 5.5);
});

test("una fila vacía o con basura cuenta como cero, no rompe la suma", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: "", unidad: "PAR" }, { cantidad: "x" as any, unidad: "PAR" }, { cantidad: 4, unidad: "PAR" }], pl());
  assert.equal(r.total, 4);
});

test("si una fila compra en OTRA unidad, el pendiente no se puede comparar", () => {
  // 255.000 GR pedidos, 1 ESTAÑÓN comprado: restar daría "te pasaste" siendo falso.
  const r = repartoDeLineaSolicitud(
    [{ cantidad: 1, unidad: "ESTAÑON" }],
    pl({ cantidad: 255000, unidad: "GR" }),
  );
  assert.equal(r.pendiente, null);
  assert.equal(r.total, 1);
  assert.equal(r.unidad, "GR", "la unidad que se muestra es la de la solicitud");
});

test("la unidad se compara sin importar mayúsculas ni espacios de más", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: 1, unidad: " par " }], pl({ unidad: "PAR" }));
  assert.notEqual(r.pendiente, null, "'par' y 'PAR' son la misma unidad");
});

test("basta UNA fila en otra unidad para que deje de ser comparable", () => {
  const r = repartoDeLineaSolicitud(
    [{ cantidad: 2, unidad: "PAR" }, { cantidad: 1, unidad: "CAJA" }],
    pl({ unidad: "PAR" }),
  );
  assert.equal(r.pendiente, null);
});

test("pasarse del pendiente se AVISA, no se prohíbe: devuelve los dos números", () => {
  // Holcim descargó 27.100 kg de los 25.000 pedidos. La orden tiene que poder decir
  // lo que de verdad va a llegar, o Bodega no lo recibe ni Contabilidad lo calza.
  const r = repartoDeLineaSolicitud([{ cantidad: 27100, unidad: "KG" }], pl({ cantidad: 25000, unidad: "KG" }));
  assert.equal(r.total, 27100);
  assert.equal(r.pendiente, 25000);   // quien llama compara y avisa; acá no se recorta
});

test("sin línea de solicitud (compra directa) no hay con qué comparar", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: 7, unidad: "UND" }], null);
  assert.equal(r.total, 7);
  assert.equal(r.pendiente, null);
  assert.equal(r.unidad, "");
});

test("lo ya ordenado baja el pendiente", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: 1, unidad: "PAR" }], pl({ cantidad: 10, cantidadOrdenada: 4 }));
  assert.equal(r.pendiente, 6);
});

test("una línea devuelta al ingeniero ya no tiene pendiente que comprar", () => {
  const r = repartoDeLineaSolicitud([{ cantidad: 1, unidad: "PAR" }], pl({ devuelta: true } as any));
  assert.equal(r.pendiente, 0);
});
