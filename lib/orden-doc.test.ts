import test from "node:test";
import assert from "node:assert/strict";
import { documentoDeOrden, destinoLineaDoc, obraLineaDoc } from "./orden-doc.ts";
import type { Orden, OrdenLinea } from "./types.ts";

// El papel que sale hacia AFUERA, el que firma el proveedor. Lo que se prueba acá es
// la tasa con la que se rotula el total: en una importación (exenta) el rótulo decía
// "13% IVA" al lado de un importe de 0,00 — CP-005636, la compra a FBG SRL que se le
// mandaba a Italia.

const linea = (id: string, ivaPct: number): OrdenLinea => ({
  id, tipo: "articulo", articuloId: "M20-1111", descripcion: "ALTERNATOR FOR YANMAR ENGINE",
  cantidad: 1, unidad: "UND", almacen: "MAQ", precioUnitario: 100, ivaPct,
} as OrdenLinea);

const orden = (lineas: OrdenLinea[]): Orden => ({
  id: "o1", numero: "CP-000001", bcNumber: "CP-005636", proveedorId: "PROV-000055",
  fecha: "2026-09-22", currencyCode: "EURO", estado: "lanzado", lineas,
} as Orden);

test("documentoDeOrden: una orden exenta se rotula 0%, no 13%", () => {
  const d = documentoDeOrden(orden([linea("a", 0), linea("b", 0)]));
  assert.equal(d.ivaPct, 0);
  assert.equal(d.iva, 0);
  assert.equal(d.total, d.subtotal);
});

test("documentoDeOrden: con IVA manda la tasa de la línea que lo cobra", () => {
  assert.equal(documentoDeOrden(orden([linea("a", 13), linea("b", 13)])).ivaPct, 13);
  // Mezcla: el rótulo toma la que cobra, y el desglose por tasa muestra las dos.
  const mixta = documentoDeOrden(orden([linea("a", 0), linea("b", 13)]));
  assert.equal(mixta.ivaPct, 13);
  assert.deepEqual(mixta.porTasaIva.map((g) => g.pct), [13, 0]);
});

// Sin líneas no hay tasa que leer: ahí el 13 sigue siendo el default de la casa.
test("documentoDeOrden: sin líneas queda el default de 13%", () => {
  assert.equal(documentoDeOrden(orden([])).ivaPct, 13);
});

// LA CASA en el papel. El proveedor que además instala ("CALENTADOR … CON INSTALACION
// INCLUIDA") necesita saber a qué casa va: con el almacén solo, la orden le llegaba
// diciendo "ALM-GRAL" y nada más.
test("obraLineaDoc: la casa va debajo del almacén, y no se repite", () => {
  // Compra a almacén pedida para una casa: se imprimen las dos cosas.
  assert.equal(destinoLineaDoc({ almacen: "ALM-GRAL", obraSolicitud: "VN-K.21" } as OrdenLinea), "ALM-GRAL");
  assert.equal(obraLineaDoc({ almacen: "ALM-GRAL", obraSolicitud: "VN-K.21" } as OrdenLinea), "VN-K.21");
  // Consumo directo: en BC el almacén de la obra tiene el MISMO código que el
  // proyecto, así que repetirlo abajo sería imprimir dos veces lo mismo.
  assert.equal(obraLineaDoc({ almacen: "VN-L.20", proyecto: "VN-L.20", taskNo: "2.2" } as OrdenLinea), "");
  // Sin casa no hay segundo renglón.
  assert.equal(obraLineaDoc({ almacen: "ALM-GRAL" } as OrdenLinea), "");
});
