// Pruebas del decisor de conciliación. El caso que sostiene es el de Kristi
// (setiembre 2026): el subcontrato se facturó a mano en BC y la orden quedó en
// "recibido 0%". Conciliar tiene que ponerla al día SOLO cuando BC lo confirma, y
// negarse —con motivo— en los casos trampa: factura anulada (CP-005380), de otro
// proveedor, orden ya recibida, o líneas que no cuadran.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirConciliacion, type OrdenConcilia, type FacturaConcilia } from "./conciliar-orden.ts";
import type { LineaBc } from "./bc-conciliacion.ts";

const orden = (p: Partial<OrdenConcilia> = {}): OrdenConcilia => ({
  id: "268",
  bcNumber: "CP-005385",
  proveedorNo: "PROV-000934",
  lineas: [{
    id: "1001", tipo: "articulo", articuloId: "S24-0014", variantCode: "",
    descripcion: "SUBCONTRATO SOBRES DE COCINA", cantidad: 1, cantidadRecibida: 0,
    precioUnitario: 314000, unidad: "M",
  }],
  ...p,
});

const factura = (p: Partial<FacturaConcilia> = {}): FacturaConcilia => ({
  numero: "CFR-010199", facturaProveedor: "583", vendorNo: "PROV-000934",
  total: 354820, currencyCode: "CRC", fecha: "2026-09-04", status: "Paid", ...p,
});

const lineaBc = (p: Partial<LineaBc> = {}): LineaBc => ({
  documentNo: "CFR-010199", lineNo: 10000, tipo: "articulo", itemNo: "S24-0014",
  variantCode: "", descripcion: "SUBCONTRATO SOBRES DE COCINA", unidad: "M", almacen: "",
  cantidad: 1, recibida: 1, facturada: 1, pendiente: 0, precioUnitario: 314000, ...p,
});

test("caso limpio: BC facturó, mismo proveedor, 0 recibido, líneas cuadran → concilia completo", () => {
  const r = decidirConciliacion(orden(), [factura()], [lineaBc()]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.lineas, [{ idOrdenCompraDet: 1001, cantidadRecibida: 1 }]);
  assert.equal(r.plan.total, 354820);
  assert.equal(r.plan.numeroFactura, "583");       // el N.º del papel, para el guard de duplicados
  assert.equal(r.plan.bcFacturaNo, "CFR-010199");  // el documento de BC, para el link y el barrido
  assert.equal(r.plan.fechaFactura, "2026-09-04");
  assert.deepEqual(r.plan.facturas, ["CFR-010199"]);
});

test("factura ANULADA en BC → no concilia (caso CP-005380/CFR-010133)", () => {
  const r = decidirConciliacion(orden({ bcNumber: "CP-005380" }), [factura({ numero: "CFR-010133", status: "Canceled" })], []);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /anulada/i);
  assert.match(r.motivo, /CFR-010133/);
});

test("factura a nombre de OTRO proveedor → no concilia (se arregla con nota de crédito)", () => {
  const r = decidirConciliacion(orden(), [factura({ vendorNo: "PROV-000111" })], [lineaBc({ vendorNo: "PROV-000111" })]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /otro proveedor/i);
  assert.match(r.motivo, /PROV-000111/);
});

test("la orden YA tiene recepción parcial → no concilia (se pone al día a mano)", () => {
  const o = orden({ lineas: [{ ...orden().lineas[0], cantidad: 2, cantidadRecibida: 1 }] });
  const r = decidirConciliacion(o, [factura()], [lineaBc({ cantidad: 2, facturada: 2 })]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /ya tiene una recepción/i);
});

test("las líneas no cuadran (cantidad distinta) → no concilia", () => {
  const r = decidirConciliacion(orden(), [factura()], [lineaBc({ cantidad: 2, facturada: 2 })]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /no coinciden/i);
});

test("sin factura viva en BC → no concilia", () => {
  const r = decidirConciliacion(orden(), [], []);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /no tiene ninguna factura/i);
});

test("sin pedido en BC → no concilia", () => {
  const r = decidirConciliacion(orden({ bcNumber: "" }), [factura()], [lineaBc()]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /Business Central/);
});

test("el cargo (flete) no se recibe ni rompe el cotejo", () => {
  const o = orden({
    lineas: [
      orden().lineas[0],
      { id: "1002", tipo: "cargo", articuloId: "", variantCode: "", descripcion: "FLETE", cantidad: 1, cantidadRecibida: 0, precioUnitario: 5000, unidad: "UND" },
    ],
  });
  const r = decidirConciliacion(o, [factura()], [lineaBc()]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Solo la línea de artículo entra en la recepción; el cargo queda por fuera.
  assert.deepEqual(r.plan.lineas, [{ idOrdenCompraDet: 1001, cantidadRecibida: 1 }]);
});

test("dos facturas vivas (parcial + parcial) que juntas cubren la orden → concilia, numeroFactura y bcFacturaNo unen ambas", () => {
  const o = orden({ lineas: [{ ...orden().lineas[0], cantidad: 2 }] });
  const r = decidirConciliacion(
    o,
    [factura({ numero: "CFR-010199", facturaProveedor: "583", total: 100000 }), factura({ numero: "CFR-010201", facturaProveedor: "584", total: 254820 })],
    [lineaBc({ documentNo: "CFR-010199", cantidad: 1, facturada: 1 }), lineaBc({ documentNo: "CFR-010201", cantidad: 1, facturada: 1 })],
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.lineas[0].cantidadRecibida, 2);
  assert.equal(r.plan.total, 354820);
  assert.equal(r.plan.numeroFactura, "583, 584");
  assert.equal(r.plan.bcFacturaNo, "CFR-010199, CFR-010201");
});
