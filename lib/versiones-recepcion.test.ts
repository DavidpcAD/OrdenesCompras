// Las versiones de una recepción en revisión: cómo entró, cada corrección de precio
// y la factura. Datos de prueba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { versionesDeRecepcion } from "./versiones-recepcion.ts";
import { detalleCorreccion, validarCorreccionPrecio } from "./corregir-precio.ts";
import { MARCA_DESDE_REVISION } from "./helpers.ts";
import type { Movimiento, Orden, OrdenLinea, Recepcion } from "./types.ts";

const linea = (p: Partial<OrdenLinea> & { id: string }): OrdenLinea => ({
  id: p.id, tipo: "articulo", descripcion: p.descripcion ?? "MATERIAL DE PRUEBA", articuloId: p.articuloId ?? "M00-0001",
  cantidad: p.cantidad ?? 40, unidad: "UND", almacen: "ALM-PRUEBA", precioUnitario: p.precioUnitario ?? 1000,
  ivaPct: p.ivaPct ?? 13, cantidadRecibida: p.cantidadRecibida ?? 40, cantidadFacturada: 0,
});
const ordenCon = (lineas: OrdenLinea[]) =>
  ({ id: "o1", estado: "lanzado", bcNumber: "CP-000001", currencyCode: "", lineas }) as unknown as Orden;
const recepcion = (lineas: Recepcion["lineas"], extra: Partial<Recepcion> = {}) =>
  ({ id: "r1", ordenId: "o1", numeroFactura: "", fechaRecepcion: "2026-01-05", lineas, recibidoPor: "Bodega de prueba", total: 0, ...extra }) as unknown as Recepcion;
const mov = (p: Partial<Movimiento>): Movimiento =>
  ({ id: p.id ?? Math.random().toString(36), entidad: "orden", idEntidad: "o1", documentoNo: "", tipoMovimiento: "", usuario: "Persona de prueba", rol: "proveeduria", fecha: "2026-01-01T00:00:00Z", ...p }) as Movimiento;

const entrada = mov({ entidad: "recepcion", idEntidad: "r1", tipoMovimiento: "recibido", fecha: "2026-01-05T10:00:00Z", usuario: "bodega1" });

// Una corrección como la escribe la app: de la orden "antes" al precio nuevo.
function correccion(o: Orden, precios: Record<string, number>, fecha: string, motivo = "factura de prueba") {
  const { cambios } = validarCorreccionPrecio(o, Object.entries(precios).map(([ordenLineaId, precio]) => ({ ordenLineaId, precio })), motivo);
  return mov({ tipoMovimiento: "precio_corregido", fecha, detalle: detalleCorreccion(cambios, motivo, "", ["relanzada (prueba)"]) });
}

test("sin correcciones no hay versiones (la recepción es lo que se ve)", () => {
  const o = ordenCon([linea({ id: "a" })]);
  assert.deepEqual(versionesDeRecepcion(recepcion([{ ordenLineaId: "a", cantidadRecibida: 40 }]), o, [entrada], []), []);
});

test("una corrección: versión 1 con el precio de entrada y versión 2 con el nuevo", () => {
  const antes = ordenCon([linea({ id: "a", precioUnitario: 1000 })]);
  const c1 = correccion(antes, { a: 1234.5678 }, "2026-01-10T15:00:00Z", "subió el precio");
  const hoy = ordenCon([linea({ id: "a", precioUnitario: 1234.5678 })]);
  const v = versionesDeRecepcion(recepcion([{ ordenLineaId: "a", cantidadRecibida: 40 }]), hoy, [entrada], [c1]);
  assert.equal(v.length, 2);
  assert.deepEqual([v[0].tipo, v[0].usuario, v[0].lineas[0].precio, v[0].subtotal, v[0].total], ["recibida", "Bodega de prueba", 1000, 40000, 45200]);
  assert.deepEqual([v[1].tipo, v[1].usuario, v[1].lineas[0].precio, v[1].subtotal], ["precio", "Persona de prueba", 1234.5678, 49382.71]);
  assert.equal(v[1].motivo, "subió el precio");
  assert.equal(v[1].cambios.length, 1);
  assert.match(v[1].cambios[0].antesTxt, /1\s?000,00/);
});

test("dos correcciones y la factura: cuatro versiones en orden", () => {
  const o0 = ordenCon([linea({ id: "a", precioUnitario: 1000 }), linea({ id: "b", articuloId: "M00-0002", precioUnitario: 50, cantidad: 10, cantidadRecibida: 10 })]);
  const c1 = correccion(o0, { a: 1100 }, "2026-01-08T10:00:00Z");
  const o1 = ordenCon([linea({ id: "a", precioUnitario: 1100 }), linea({ id: "b", articuloId: "M00-0002", precioUnitario: 50, cantidad: 10, cantidadRecibida: 10 })]);
  const c2 = correccion(o1, { a: 1200, b: 60 }, "2026-01-09T10:00:00Z");
  const hoy = ordenCon([linea({ id: "a", precioUnitario: 1200 }), linea({ id: "b", articuloId: "M00-0002", precioUnitario: 60, cantidad: 10, cantidadRecibida: 10 })]);
  const fact = mov({ entidad: "recepcion", idEntidad: "r1", tipoMovimiento: "creado", documentoNo: "0001", fecha: "2026-01-11T10:00:00Z", detalle: `Factura 0001 registrada ${MARCA_DESDE_REVISION}` });
  const v = versionesDeRecepcion(recepcion([{ ordenLineaId: "a", cantidadRecibida: 40 }, { ordenLineaId: "b", cantidadRecibida: 10 }], { numeroFactura: "0001" }), hoy, [entrada, fact], [c2, c1]);
  assert.deepEqual(v.map((x) => [x.n, x.tipo]), [[1, "recibida"], [2, "precio"], [3, "precio"], [4, "factura"]]);
  assert.deepEqual(v.map((x) => x.subtotal), [40500, 44500, 48600, 48600]);
  assert.equal(v[2].cambios.length, 2);
  assert.equal(v[3].numeroFactura, "0001");
});

test("lo que pasó antes de la recepción o después de la factura no es una versión de ella", () => {
  const o0 = ordenCon([linea({ id: "a", precioUnitario: 1000 })]);
  const antesDeRecibir = correccion(ordenCon([linea({ id: "a", precioUnitario: 900 })]), { a: 1000 }, "2026-01-02T10:00:00Z");
  const fact = mov({ entidad: "recepcion", idEntidad: "r1", tipoMovimiento: "creado", documentoNo: "0001", fecha: "2026-01-06T10:00:00Z", detalle: `Factura 0001 registrada ${MARCA_DESDE_REVISION}` });
  const despuesDeFacturar = correccion(o0, { a: 1500 }, "2026-01-07T10:00:00Z");
  assert.deepEqual(versionesDeRecepcion(recepcion([{ ordenLineaId: "a", cantidadRecibida: 40 }]), o0, [entrada, fact], [antesDeRecibir, despuesDeFacturar]), []);
});

test("una recepción que entró con su factura no tiene versiones, y un precio de factura propio no se mueve", () => {
  const o0 = ordenCon([linea({ id: "a", precioUnitario: 1000 })]);
  const c1 = correccion(o0, { a: 1100 }, "2026-01-08T10:00:00Z");
  const conFactura = mov({ entidad: "recepcion", idEntidad: "r1", tipoMovimiento: "creado", fecha: "2026-01-05T10:00:00Z", detalle: "Factura 0001" });
  assert.deepEqual(versionesDeRecepcion(recepcion([{ ordenLineaId: "a", cantidadRecibida: 40 }]), ordenCon([linea({ id: "a", precioUnitario: 1100 })]), [conFactura], [c1]), []);
  assert.deepEqual(versionesDeRecepcion(recepcion([{ ordenLineaId: "a", cantidadRecibida: 40, precioFactura: 990 }]), ordenCon([linea({ id: "a", precioUnitario: 1100 })]), [entrada], [c1]), []);
});
