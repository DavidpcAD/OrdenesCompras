// El movimiento de compras de un insumo según las órdenes de la app (Inventarios,
// al expandir la fila). Si esto ordena mal o mezcla artículos, la pantalla miente
// sobre qué se compró y cuándo.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { comprasDeInsumo } from "./helpers.ts";

const linea = (art: string, cantidad: number, precio: number, recibida = 0, tipo: "articulo" | "cargo" = "articulo") => ({
  id: `${art}-${cantidad}`, tipo, articuloId: art, descripcion: art, cantidad, unidad: "UND", almacen: "ALM-GRAL",
  precioUnitario: precio, ivaPct: 13, cantidadRecibida: recibida, cantidadFacturada: 0,
});
const orden = (id: string, fecha: string, lineas: unknown[], extra: Record<string, unknown> = {}) => ({
  id, numero: `INT-${id}`, bcNumber: `CP-00${id}`, proveedorId: "PROV-000101", proveedorNombre: "ALMACENES EL COLONO, S.A",
  fecha, currencyCode: "", estado: "lanzado", versionesArchivadas: 0, lineas, ...extra,
}) as any;

const ordenes = [
  orden("1", "2026-08-01", [linea("M04-0073", 10, 17000, 10), linea("M01-0063", 2, 8500)]),
  orden("2", "2026-09-01", [linea("m04-0073", 25, 17270)], { estado: "abierto", currencyCode: "USD" }),
  orden("3", "2026-08-15", [linea("FLETE", 1, 5000, 0, "cargo"), linea("M04-0073", 5, 16900, 5)]),
];

test("filtra por artículo sin importar mayúsculas y no mezcla otros", () => {
  const c = comprasDeInsumo(ordenes, "M04-0073");
  assert.equal(c.length, 3);
  assert.ok(c.every((x) => x.orden.startsWith("CP-00")));
  assert.equal(comprasDeInsumo(ordenes, "M01-0063").length, 1);
});

test("de la más reciente a la más vieja", () => {
  assert.deepEqual(comprasDeInsumo(ordenes, "M04-0073").map((x) => x.fecha), ["2026-09-01", "2026-08-15", "2026-08-01"]);
});

test("un cargo no es una compra del insumo", () => {
  assert.deepEqual(comprasDeInsumo(ordenes, "FLETE"), []);
});

test("lleva proveedor, estado, moneda (vacía = CRC) y lo recibido", () => {
  const [ultima, , primera] = comprasDeInsumo(ordenes, "M04-0073");
  assert.equal(ultima.proveedor, "ALMACENES EL COLONO, S.A");
  assert.equal(ultima.estado, "abierto");
  assert.equal(ultima.moneda, "USD");
  assert.equal(ultima.recibida, 0);
  assert.equal(primera.moneda, "CRC");
  assert.equal(primera.recibida, 10);
  assert.equal(primera.precioUnitario, 17000);
});

test("sin código no hay compras", () => {
  assert.deepEqual(comprasDeInsumo(ordenes, ""), []);
});
