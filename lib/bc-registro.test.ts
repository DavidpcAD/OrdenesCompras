// Cuando BC rechaza un registro, la app tiene que saber si REINTENTAR sirve o no.
// Durante meses la respuesta fue siempre "la orden queda por recibir para
// reintentar", y contra estos dos "no" reintentar no sirve nunca: el material ya
// entró en BC y la orden se quedaba trabada para siempre en la app.
//
// Los textos de acá son los REALES del 28 ago 2026 (CP-005148 y la factura 586265),
// tal como llegan: el mensaje de BC envuelto por bcPostear.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarFalloBc } from "./bc.ts";

const envuelto = (mensaje: string) =>
  `BC registrar 400: {"error":{"code":"Application_DialogException","message":"${mensaje} CorrelationId: 5ad0cc6c-2ef8-49b6-8f26-c9893727c69f."}}`;

test("factura del proveedor ya registrada en BC", () => {
  assert.equal(
    clasificarFalloBc(envuelto("Purchase Invoice 586265 already exists for this vendor.")),
    "factura-duplicada",
  );
});

test("misma cosa con BC en español", () => {
  assert.equal(
    clasificarFalloBc(envuelto("La factura de compra 586265 ya existe para este proveedor.")),
    "factura-duplicada",
  );
});

test("el pedido ya no está en BC (se completó y BC lo borró)", () => {
  assert.equal(
    clasificarFalloBc(envuelto("Pedido de compra CP-005148 no encontrado en BC.")),
    "pedido-no-existe",
  );
});

test("otra forma de decir lo mismo", () => {
  assert.equal(clasificarFalloBc("El pedido de compra CP-005148 no existe."), "pedido-no-existe");
});

test("un artículo que no existe NO es el pedido que no existe", () => {
  // Si esto se leyera como "pedido-no-existe", la app le ofrecería a Bodega
  // conciliar una recepción que en BC nunca ocurrió.
  assert.equal(
    clasificarFalloBc(envuelto("The Item does not exist. Identification fields and values: No.='M99-9999'")),
    "reintentable",
  );
});

test("pedido lanzado (lo arregla el reintento reabriéndolo) sigue siendo reintentable", () => {
  assert.equal(
    clasificarFalloBc("BC registrar 400: Status must be equal to 'Open' in Purchase Header"),
    "reintentable",
  );
});

test("periodo contable cerrado: reintentable (se cambia la fecha y va)", () => {
  assert.equal(
    clasificarFalloBc(envuelto("Posting Date is not within your range of allowed posting dates.")),
    "reintentable",
  );
});

test("sin mensaje no se inventa un motivo", () => {
  assert.equal(clasificarFalloBc(""), "reintentable");
  assert.equal(clasificarFalloBc(undefined as unknown as string), "reintentable");
});
