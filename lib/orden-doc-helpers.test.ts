// EL PAPEL QUE LE LLEGA AL PROVEEDOR.
//
// Estas cuatro salen impresas o deciden si se imprime. Lo que pase acá no se ve en
// una pantalla que alguien pueda corregir: sale del edificio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDoc, etiquetaUnidad, nombreArchivoOrden, ordenImprimible } from "./orden-doc.ts";
import type { Orden } from "./types.ts";

const orden = (o: Partial<Orden> = {}): Orden =>
  ({ id: "1", numero: "CP-000037", proveedorId: "PROV-001", fecha: "2026-05-10",
     currencyCode: "", estado: "lanzado", lineas: [], ...o } as Orden);

test("al proveedor solo se le manda una orden aprobada o ya completada", () => {
  // Mandarle el PDF de una orden que Aprobación todavía no lanzó es prometerle una
  // compra que nadie autorizó.
  assert.equal(ordenImprimible(orden({ estado: "lanzado" })), true);
  assert.equal(ordenImprimible(orden({ estado: "completado" })), true);
  for (const e of ["abierto", "rechazado", "pendiente", "anulado", ""])
    assert.equal(ordenImprimible(orden({ estado: e as any })), false, e);
});

test("el importe sale SIEMPRE con dos decimales, aunque sea redondo", () => {
  // En un documento de cobro "1,500" y "1,500.00" no son lo mismo de leer.
  assert.equal(fmtDoc(1500), "1,500.00");
  assert.equal(fmtDoc(1234567.5), "1,234,567.50");
});

test("un importe que falta se imprime como cero, no como 'NaN'", () => {
  assert.equal(fmtDoc(undefined as any), "0.00");
  assert.equal(fmtDoc(NaN), "0.00");
  assert.equal(fmtDoc(null as any), "0.00");
});

test("las cantidades pueden pedir más decimales que la plata", () => {
  // 0,125 toneladas no es 0,13: el proveedor factura lo que dice el papel.
  assert.equal(fmtDoc(0.125, 3), "0.125");
  assert.equal(fmtDoc(10, 0), "10");
});

test("la unidad se imprime con el nombre que el proveedor entiende, si BC lo da", () => {
  assert.equal(etiquetaUnidad("EST", { EST: "Estañón" }), "Estañón");
  // Sin descripción se imprime el código: es mejor "EST" que nada.
  assert.equal(etiquetaUnidad("EST"), "EST");
  assert.equal(etiquetaUnidad("est", { EST: "Estañón" }), "Estañón", "no debe importar la caja");
  assert.equal(etiquetaUnidad(""), "");
});

test("el archivo se llama por el N.º de BC, que es el que el proveedor conoce", () => {
  assert.equal(nombreArchivoOrden(orden({ bcNumber: "CP-005814" })), "CP-005814-orden-de-compra.pdf");
});

test("sin N.º de BC cae al consecutivo interno, y nunca queda sin nombre", () => {
  assert.equal(nombreArchivoOrden(orden({ bcNumber: "", numero: "CP-000037" })), "CP-000037-orden-de-compra.pdf");
  assert.equal(nombreArchivoOrden(orden({ bcNumber: "", numero: "" })), "orden-orden-de-compra.pdf");
});

test("un N.º con barras o espacios no puede armar una ruta ni romper la descarga", () => {
  assert.equal(nombreArchivoOrden(orden({ bcNumber: "CP/005814 bis" })), "CP-005814-bis-orden-de-compra.pdf");
});
