import test from "node:test";
import assert from "node:assert/strict";
import { textoDelFallo, textoPedidoAbierto } from "./fallo-posteo.ts";

// Lo que va a leer, semanas después, quien pregunte qué le pasó a esta orden.
test("el fallo se anota con el vocabulario del oficio y el dato concreto", () => {
  const t = textoDelFallo("recibir", "CP-005541", "The document must be released");
  assert.match(t, /recibir el material/);
  assert.match(t, /CP-005541/);
  assert.match(t, /The document must be released/);
});

test("el aviso del pedido que quedó abierto dice qué pasó y quién lo destraba", () => {
  const t = textoPedidoAbierto("registrar", "CP-005541");
  assert.match(t, /SIN LANZAR EN BC/);
  assert.match(t, /CP-005541/);
  assert.match(t, /Bodega/);
  assert.match(t, /aprobación/);
});
