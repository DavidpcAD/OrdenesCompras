// Corregir el precio de una orden con material recibido: qué líneas se dejan, qué
// se valida y cómo cada una encuentra SU línea del pedido en BC. Datos de prueba.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  motivoNoCorregible, lineasCorregibles, puedeCorregirPrecio, validarCorreccionPrecio,
  emparejarConBc, detalleCorreccion, precioTxt, ordenConPrecios,
} from "./corregir-precio.ts";
import type { LineaBc } from "./bc-conciliacion.ts";
import type { Orden, OrdenLinea } from "./types.ts";

const linea = (p: Partial<OrdenLinea> & { id: string }): OrdenLinea => ({
  id: p.id, tipo: p.tipo ?? "articulo", descripcion: p.descripcion ?? "MATERIAL DE PRUEBA",
  articuloId: p.articuloId ?? "M00-0001", variantCode: p.variantCode,
  cantidad: p.cantidad ?? 40, unidad: p.unidad ?? "UND", almacen: p.almacen ?? "ALM-PRUEBA",
  precioUnitario: p.precioUnitario ?? 1000, ivaPct: p.ivaPct ?? 13,
  cantidadRecibida: p.cantidadRecibida ?? 40, cantidadFacturada: p.cantidadFacturada ?? 0,
  chargeNo: p.chargeNo,
});

const orden = (lineas: OrdenLinea[], extra: Partial<Orden> = {}) =>
  ({ id: "o1", estado: "lanzado", bcNumber: "CP-000001", currencyCode: "", lineas, ...extra }) as unknown as Orden;

const bc = (p: Partial<LineaBc> & { lineNo: number }): LineaBc => ({
  documentNo: "CP-000001", lineNo: p.lineNo, tipo: p.tipo ?? "articulo", itemNo: p.itemNo ?? "M00-0001",
  variantCode: p.variantCode ?? "", descripcion: "", unidad: "UND", almacen: "ALM-PRUEBA",
  cantidad: p.cantidad ?? 40, recibida: p.recibida ?? 40, facturada: p.facturada ?? 0, pendiente: 0,
  precioUnitario: p.precioUnitario ?? 1000,
});

test("corregibles: fuera el cargo y lo facturado completo; lo recibido sin facturar sí", () => {
  assert.equal(motivoNoCorregible(linea({ id: "a" })), null);
  assert.match(motivoNoCorregible(linea({ id: "b", tipo: "cargo" })) ?? "", /cargo de producto/);
  assert.match(motivoNoCorregible(linea({ id: "c", cantidadFacturada: 40 })) ?? "", /facturada completa/);
  // Facturada a medias: lo que falta todavía se puede corregir.
  assert.equal(motivoNoCorregible(linea({ id: "d", cantidadFacturada: 10 })), null);
  assert.deepEqual(lineasCorregibles(orden([linea({ id: "a" }), linea({ id: "c", cantidadFacturada: 40 })])).map((l) => l.id), ["a"]);
});

test("el botón aparece solo con recepciones, pedido en BC y algo corregible", () => {
  const o = orden([linea({ id: "a" })]);
  assert.equal(puedeCorregirPrecio(o, true), true);
  assert.equal(puedeCorregirPrecio(o, false), false, "sin recepciones se corrige con Editar");
  assert.equal(puedeCorregirPrecio(orden([linea({ id: "a" })], { bcNumber: "" }), true), false);
  assert.equal(puedeCorregirPrecio(orden([linea({ id: "a" })], { estado: "completado" }), true), false);
  assert.equal(puedeCorregirPrecio(orden([linea({ id: "a", cantidadFacturada: 40 })]), true), false);
});

test("validar: pide motivo, precio > 0, máximo 4 decimales (los de la base), y descarta lo que no cambió", () => {
  const o = orden([linea({ id: "a" }), linea({ id: "b", articuloId: "M00-0002", precioUnitario: 50 })]);
  assert.match(validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1100 }], "").error ?? "", /por qué cambia/);
  assert.match(validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 0 }], "factura 1").error ?? "", /mayor que cero/);
  assert.match(validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1.12345 }], "factura 1").error ?? "", /4 decimales/);
  assert.match(validarCorreccionPrecio(o, [{ ordenLineaId: "zz", precio: 1 }], "factura 1").error ?? "", /ya no está/);
  assert.match(validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1 }, { ordenLineaId: "a", precio: 2 }], "factura 1").error ?? "", /dos veces/);
  assert.match(validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1000 }], "factura 1").error ?? "", /No cambió ningún precio/);
  const ok = validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1234.5678 }, { ordenLineaId: "b", precio: 50 }], "factura 1");
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.cambios.map((c) => [c.linea.id, c.antes, c.nuevo]), [["a", 1000, 1234.5678]]);
});

test("validar: nada de corregir sin pedido en BC o con la orden cerrada", () => {
  assert.match(validarCorreccionPrecio(orden([linea({ id: "a" })], { bcNumber: "" }), [{ ordenLineaId: "a", precio: 2 }], "factura 1").error ?? "", /con Editar/);
  assert.match(validarCorreccionPrecio(orden([linea({ id: "a" })], { estado: "completado" }), [{ ordenLineaId: "a", precio: 2 }], "factura 1").error ?? "", /solo se corrige/);
  assert.match(validarCorreccionPrecio(orden([linea({ id: "a", cantidadFacturada: 40 })]), [{ ordenLineaId: "a", precio: 2 }], "factura 1").error ?? "", /facturada completa/);
});

test("emparejar: cada línea encuentra la suya en BC, con el precio leído como esperado", () => {
  const o = orden([linea({ id: "a" })]);
  const { cambios } = validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1234.5678 }], "factura 1");
  const r = emparejarConBc(cambios, [bc({ lineNo: 10000 })], "CP-000001");
  assert.equal(r.error, undefined);
  assert.deepEqual(r.lineas, [{ lineNo: 10000, itemNo: "M00-0001", directUnitCost: 1234.5678, expectedCost: 1000 }]);
  assert.deepEqual(r.avisos, []);
});

test("emparejar: dos líneas del mismo artículo con precios cruzados no se pisan", () => {
  const o = orden([
    linea({ id: "a", precioUnitario: 1000, cantidad: 5, cantidadRecibida: 5 }),
    linea({ id: "b", precioUnitario: 2000, cantidad: 5, cantidadRecibida: 5 }),
  ]);
  const { cambios } = validarCorreccionPrecio(o, [{ ordenLineaId: "b", precio: 2500 }, { ordenLineaId: "a", precio: 1500 }], "factura 1");
  const r = emparejarConBc(cambios, [
    bc({ lineNo: 10000, cantidad: 5, precioUnitario: 1000 }),
    bc({ lineNo: 20000, cantidad: 5, precioUnitario: 2000 }),
  ], "CP-000001");
  assert.deepEqual(r.lineas.map((l) => [l.lineNo, l.directUnitCost]), [[20000, 2500], [10000, 1500]]);
});

test("emparejar: si BC tenía otro precio se avisa; si no está o ya se facturó, se corta", () => {
  const o = orden([linea({ id: "a" })]);
  const { cambios } = validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1200 }], "factura 1");
  const distinto = emparejarConBc(cambios, [bc({ lineNo: 10000, precioUnitario: 990 })], "CP-000001");
  assert.equal(distinto.lineas[0].expectedCost, 990, "se escribe sobre lo que se leyó en BC");
  assert.match(distinto.avisos[0], /en BC estaba a/);
  assert.match(emparejarConBc(cambios, [bc({ lineNo: 10000, cantidad: 39 })], "CP-000001").error ?? "", /no está en el pedido CP-000001/);
  assert.match(emparejarConBc(cambios, [bc({ lineNo: 10000, itemNo: "M00-0009" })], "CP-000001").error ?? "", /Verificar contra BC/);
  assert.match(emparejarConBc(cambios, [bc({ lineNo: 10000, facturada: 40 })], "CP-000001").error ?? "", /facturada completa/);
});

test("emparejar: la variante tiene que ser la misma", () => {
  const o = orden([linea({ id: "a", variantCode: "V1" })]);
  const { cambios } = validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1200 }], "factura 1");
  assert.ok(emparejarConBc(cambios, [bc({ lineNo: 10000, variantCode: "V2" })], "CP-000001").error);
  assert.equal(emparejarConBc(cambios, [bc({ lineNo: 10000, variantCode: "v1" })], "CP-000001").lineas[0].lineNo, 10000);
});

test("bitácora y totales: el precio va con todos sus decimales", () => {
  assert.match(precioTxt(1234.5678, ""), /1\s?234,5678/);
  assert.match(precioTxt(1000, ""), /1\s?000,00/);
  const o = orden([linea({ id: "a", descripcion: "MATERIAL DE PRUEBA" })]);
  const { cambios } = validarCorreccionPrecio(o, [{ ordenLineaId: "a", precio: 1234.5678 }], "factura 1");
  const d = detalleCorreccion(cambios, "  factura   1  del proveedor ", "");
  assert.match(d, /^Precio corregido · MATERIAL DE PRUEBA \(M00-0001\): /);
  assert.match(d, /1\s?000,00 → .*1\s?234,5678/);
  assert.match(d, /Motivo: factura 1 del proveedor$/);
  assert.equal(ordenConPrecios(o, [{ ordenLineaId: "a", precio: 7 }]).lineas[0].precioUnitario, 7);
  assert.equal(o.lineas[0].precioUnitario, 1000, "no muta la orden original");
});
