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
import { clasificarFalloBc, cotejoProveedor, estadoLanzamientoBc } from "./bc.ts";

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

// ── EL PROVEEDOR DEL PEDIDO ──────────────────────────────────────────────────
// El caso real: CP-005183. La orden era de FERRETERIA EPA S.A (PROV-000522) y para
// cuando Bodega recibió, el pedido en BC había pasado a PROV-000163 (Corazón de
// Papel). Nadie lo comparó y la factura 15403 de EPA quedó cargada a otro proveedor.
// Estas pruebas fijan las tres respuestas que importan: calza, NO calza, y "no se
// pudo mirar" — que NO es lo mismo que "está bien", pero tampoco frena.
test("el proveedor del pedido de BC calza con el de la orden", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: "PROV-000522", vendorName: "FERRETERIA EPA S.A" }, "PROV-000522");
  assert.equal(r.ok, true);
  assert.equal(r.verificado, true);
});

test("no calza: frena y dice los dos proveedores por su nombre", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: "PROV-000163", vendorName: "3-101-739774 Sociedad Anonima/Corazón de Papel" }, "PROV-000522");
  assert.equal(r.ok, false);
  assert.equal(r.verificado, true);
  assert.match(r.mensaje ?? "", /PROV-000163/);
  assert.match(r.mensaje ?? "", /Corazón de Papel/);
  assert.match(r.mensaje ?? "", /PROV-000522/);
});

test("mayúsculas y espacios no son un desajuste", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: " prov-000522 ", vendorName: "" }, "PROV-000522");
  assert.equal(r.ok, true);
});

test("BC no contestó (o el pedido ya no está): no se frena, pero queda sin verificar", () => {
  const r = cotejoProveedor("CP-005183", null, "PROV-000522");
  assert.equal(r.ok, true);
  assert.equal(r.verificado, false);
});

test("sin proveedor en la orden no hay nada que cotejar", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: "PROV-000163", vendorName: "" }, "");
  assert.equal(r.ok, true);
  assert.equal(r.verificado, false);
});

// ── EL ESTADO DEL PEDIDO EN BC ───────────────────────────────────────────────
// CP-005143: la app decía "lanzado" y en BC el pedido seguía Abierto, porque quien
// lanza es la app de Aprobación. `Format(PurchHeader.Status)` viaja en el IDIOMA DE
// LA SESIÓN del web service, así que el estado llega en inglés o en español según
// quién pregunte: comparar contra un solo texto era un freno con fecha de
// vencimiento. La API estándar no sirve para esto (devuelve "Open" hasta para los
// lanzados); el único que dice la verdad es AdelantePO_GetOrderLines.
test("el estado de BC se entiende en los dos idiomas", () => {
  assert.equal(estadoLanzamientoBc("Open"), "abierto");
  assert.equal(estadoLanzamientoBc("Abierto"), "abierto");
  assert.equal(estadoLanzamientoBc("Released"), "lanzado");
  assert.equal(estadoLanzamientoBc("Lanzado"), "lanzado");
  assert.equal(estadoLanzamientoBc("Pending Approval"), "pendiente-aprobacion");
  assert.equal(estadoLanzamientoBc("Pendiente de aprobación"), "pendiente-aprobacion");
});

test("sin estado no se inventa uno: es 'desconocido', y desconocido NO frena", () => {
  assert.equal(estadoLanzamientoBc(undefined), "desconocido");
  assert.equal(estadoLanzamientoBc(""), "desconocido");
  assert.equal(estadoLanzamientoBc("   "), "desconocido");
  assert.equal(estadoLanzamientoBc("Pending Prepayment"), "desconocido");
});
