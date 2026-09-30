// Pruebas del barrido: facturas registradas en BC que la app no tiene.
//
// Los dos casos reales que hay que sostener, los dos del 30 de setiembre de 2026:
//   - CP-005394: la posteó la app (BUSINESSCENTRAL_API_ADELANTE) y no alcanzó a
//     guardarla acá. Es el bug, y pegó una sola vez.
//   - CP-005714 y otras 69: las registró una persona a mano en BC. No es bug.
// Y el falso positivo que hay que NO cometer: una recepción conciliada a mano
// queda sin `bcFacturaNo`, y si se cruzara solo por ese campo el barrido acusaría
// de nuevo la orden que alguien ya puso al día.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cruzarFacturasDeBc, resumirBarrido, claveFactura, agruparPorPedido, type OrdenBarrido, type RecepcionBarrido } from "./barrido-bc.ts";
import type { FacturaBcPeriodo } from "./barrido-bc.ts";

const orden = (p: Partial<OrdenBarrido> = {}): OrdenBarrido => ({
  id: "268", numero: "CP-000267", bcNumber: "CP-005394", fecha: "2026-09-08",
  estado: "lanzado", currencyCode: "", proveedorNombre: "PIMMSA PINTURAS MACA Y MONTENEGRO S.A", ...p,
});

const fact = (p: Partial<FacturaBcPeriodo> = {}): FacturaBcPeriodo => ({
  numero: "CFR-010109", pedido: "CP-005394", fecha: "2026-09-10",
  vendorNo: "PROV-001277", vendorName: "PIMMSA", facturaProveedor: "19741",
  total: 973359.85, currencyCode: "", estado: "Open", ...p,
});

test("BC facturó y la app no tiene ni una recepción: sale en el barrido", () => {
  const filas = cruzarFacturasDeBc([orden()], [], [fact()], { "CFR-010109": "BUSINESSCENTRAL_API_ADELANTE" });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].bcNumber, "CP-005394");
  assert.equal(filas[0].faltantes.length, 1);
  assert.equal(filas[0].clase, "app");
  assert.equal(filas[0].faltantes[0].laPosteoLaApp, true);
  assert.equal(Math.round(filas[0].importe), 973360);
});

test("la registró una persona en BC: sale igual, pero no es el bug", () => {
  const filas = cruzarFacturasDeBc([orden()], [], [fact()], { "CFR-010109": "KATTYA" });
  assert.equal(filas[0].clase, "persona");
  assert.equal(filas[0].faltantes[0].usuario, "KATTYA");
  assert.equal(filas[0].faltantes[0].laPosteoLaApp, false);
});

test("la recepción ya está guardada acá con el N.º de BC: no hay desfase", () => {
  const rs: RecepcionBarrido[] = [{ ordenId: "268", numeroFactura: "19741", bcFacturaNo: "CFR-010109" }];
  assert.equal(cruzarFacturasDeBc([orden()], rs, [fact()]).length, 0);
});

// El falso positivo que hay que evitar: conciliar a mano guarda la recepción con
// el N.º del PROVEEDOR y sin el de BC. Cruzar solo por bcFacturaNo la acusaría.
test("recepción conciliada (sin bcFacturaNo): tampoco hay desfase", () => {
  const rs: RecepcionBarrido[] = [{ ordenId: "268", numeroFactura: "19741" }];
  assert.equal(cruzarFacturasDeBc([orden()], rs, [fact()]).length, 0);
});

test("el N.º del papel se compara sin ceros al frente ni espacios", () => {
  assert.equal(claveFactura(" 0019741 "), "19741");
  assert.equal(claveFactura("cfr-010109"), "CFR-010109");
  const rs: RecepcionBarrido[] = [{ ordenId: "268", numeroFactura: "019741" }];
  assert.equal(cruzarFacturasDeBc([orden()], rs, [fact()]).length, 0);
});

test("parcial: BC tiene dos facturas y la app una (CP-005138)", () => {
  const o = orden({ id: "12", numero: "CP-000011", bcNumber: "CP-005138" });
  const f1 = fact({ numero: "CFR-009792", pedido: "CP-005138", facturaProveedor: "18287", total: 119999.9 });
  const f2 = fact({ numero: "CFR-009989", pedido: "CP-005138", facturaProveedor: "18295", total: 239999.8 });
  const rs: RecepcionBarrido[] = [{ ordenId: "12", numeroFactura: "18295", bcFacturaNo: "CFR-009989" }];
  const filas = cruzarFacturasDeBc([o], rs, [f1, f2], { "CFR-009792": "JESSIE" });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].faltantes.length, 1);
  assert.equal(filas[0].faltantes[0].numero, "CFR-009792");
  assert.equal(filas[0].recepcionesApp, 1);
});

test("una factura anulada en BC no es material que falte registrar", () => {
  const filas = cruzarFacturasDeBc([orden()], [], [fact({ estado: "Canceled" })]);
  assert.equal(filas.length, 0);
  assert.equal(agruparPorPedido([fact({ estado: "Canceled" })]).size, 0);
});

test("la orden que no vive en BC no se cruza con nada", () => {
  assert.equal(cruzarFacturasDeBc([orden({ bcNumber: "" })], [], [fact()]).length, 0);
});

test("un pedido de BC que no es de esta app se ignora", () => {
  const filas = cruzarFacturasDeBc([orden()], [], [fact({ pedido: "CP-009999", numero: "CFR-099999" })]);
  assert.equal(filas.length, 0);
});

test("el resumen separa lo que posteó la app de lo que registró una persona", () => {
  const o1 = orden();
  const o2 = orden({ id: "700", numero: "CP-000699", bcNumber: "CP-005714", fecha: "2026-09-22" });
  const f2 = fact({ numero: "CFR-010674", pedido: "CP-005714", facturaProveedor: "39", total: 540705 });
  const filas = cruzarFacturasDeBc([o1, o2], [], [fact(), f2], {
    "CFR-010109": "BUSINESSCENTRAL_API_ADELANTE", "CFR-010674": "KATTYA",
  });
  assert.equal(filas.length, 2);
  assert.equal(filas[0].bcNumber, "CP-005714");   // lo más nuevo primero
  const r = resumirBarrido(filas);
  assert.equal(r.ordenes, 2);
  assert.equal(r.facturas, 2);
  assert.equal(r.deLaApp, 1);
  assert.equal(r.dePersona, 1);
  assert.equal(Math.round(r.importe), 1514065);
});

test("sin el usuario de BC el barrido igual reporta, sin acusar a la app", () => {
  const filas = cruzarFacturasDeBc([orden()], [], [fact()], {});
  assert.equal(filas[0].clase, "persona");
  assert.equal(filas[0].faltantes[0].usuario, "");
  assert.equal(filas[0].faltantes[0].laPosteoLaApp, false);
});
