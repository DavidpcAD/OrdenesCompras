import { test } from "node:test";
import assert from "node:assert/strict";
import { claveNombre, enumBc, etiquetaBloqueo, fichaDeOdata, ncPendientesPorProveedor, tieneContacto } from "./proveedores.ts";
import type { NotaCreditoLinea } from "./types.ts";

// Datos de prueba obvios: el repo es público.

test("enumBc: el espacio escapado de OData queda vacío y el de adentro vuelve a ser espacio", () => {
  assert.equal(enumBc("_x0020_"), "");
  assert.equal(enumBc(" "), "");
  assert.equal(enumBc("Cédula_x0020_Física"), "Cédula Física");
  assert.equal(enumBc(undefined), "");
});

test("ficha: la cédula sale del campo de la localización y, si está vacío, del VAT", () => {
  const a = fichaDeOdata({ No: "PROV-TEST-1", Name: "Proveedor de Prueba", GJW_No_Identificacion: "3-000-000000", VAT_Registration_No: "otro" });
  assert.equal(a.cedula, "3-000-000000");
  const b = fichaDeOdata({ No: "PROV-TEST-2", Name: "Proveedor de Prueba Dos", GJW_No_Identificacion: "", VAT_Registration_No: "1-0000-0000" });
  assert.equal(b.cedula, "1-0000-0000");
});

test("ficha: dirección en una línea, fecha vacía de BC y bloqueo en blanco quedan limpios", () => {
  const f = fichaDeOdata({
    No: "PROV-TEST-3", Name: "", Address: "Calle de prueba", Address_2: "Bodega 1",
    Last_Date_Modified: "0001-01-01", Blocked: " ", Balance_LCY: "1500.5", Currency_Code: "",
  });
  assert.equal(f.nombre, "PROV-TEST-3", "sin nombre, se ve el código");
  assert.equal(f.direccion, "Calle de prueba, Bodega 1");
  assert.equal(f.modificado, "");
  assert.equal(f.bloqueado, "");
  assert.equal(f.saldo, 1500.5);
  assert.equal(f.moneda, "", "vacío en BC = colones; la pantalla decide cómo mostrarlo");
});

test("etiquetaBloqueo: activo, bloqueado del todo o solo pagos", () => {
  assert.equal(etiquetaBloqueo(""), "");
  assert.equal(etiquetaBloqueo("_x0020_"), "");
  assert.equal(etiquetaBloqueo("All"), "Bloqueado");
  assert.equal(etiquetaBloqueo("Payment"), "Pagos bloqueados");
});

test("tieneContacto: basta teléfono, celular o correo", () => {
  assert.equal(tieneContacto({ telefono: "", celular: "", correo: "" }), false);
  assert.equal(tieneContacto({ telefono: "", celular: "8888-0000", correo: "" }), true);
  assert.equal(tieneContacto({ telefono: "", celular: "", correo: "prueba@example.com" }), true);
});

test("claveNombre: sin tildes, mayúsculas ni puntuación", () => {
  assert.equal(claveNombre("Ferretería de Prueba, S.A."), claveNombre("FERRETERIA DE PRUEBA SA"));
});

const nc = (p: Partial<NotaCreditoLinea>): NotaCreditoLinea => ({
  id: p.id ?? "nc", ordenId: "o1", ordenNumero: "CP-TEST-1", descripcion: "Material de prueba",
  motivo: "danado", cantidad: 1, fecha: "2026-11-01T00:00:00.000Z", estado: "pendiente", ...p,
});

test("NC por proveedor: agrupa por el código de la orden, suma por moneda y salta las acreditadas", () => {
  const ordenes = [
    { id: "o1", proveedorId: "PROV-TEST-1", proveedorNombre: "Proveedor de Prueba", currencyCode: "" },
    { id: "o2", proveedorId: "PROV-TEST-1", proveedorNombre: "Proveedor de Prueba", currencyCode: "USD" },
  ];
  const fichas = [{ codigo: "PROV-TEST-1", nombre: "Proveedor de Prueba" }];
  const m = ncPendientesPorProveedor([
    nc({ id: "a", ordenId: "o1", cantidad: 2, precioUnitario: 100 }),
    nc({ id: "b", ordenId: "o1", cantidad: 1, precioUnitario: 50 }),
    nc({ id: "c", ordenId: "o2", ordenNumero: "CP-TEST-2", cantidad: 3, precioUnitario: 10 }),
    nc({ id: "d", ordenId: "o1", cantidad: 9, precioUnitario: 999, estado: "resuelta" }),
  ], ordenes, fichas);
  const g = m.get("PROV-TEST-1")!;
  assert.equal(g.lineas.length, 3);
  assert.deepEqual(Object.fromEntries(g.porMoneda), { CRC: 250, USD: 30 });
  assert.deepEqual(g.ordenes.sort(), ["CP-TEST-1", "CP-TEST-2"]);
});

test("NC por proveedor: sin la orden se cruza por nombre; lo que no calza con ninguna ficha queda fuera", () => {
  const fichas = [{ codigo: "PROV-TEST-9", nombre: "Ferretería de Prueba S.A." }];
  const m = ncPendientesPorProveedor([
    nc({ id: "a", ordenId: "no-esta", proveedor: "FERRETERIA DE PRUEBA SA", precioUnitario: 10 }),
    nc({ id: "b", ordenId: "no-esta", proveedor: "Nadie Conocido" }),
  ], [], fichas);
  assert.equal(m.get("PROV-TEST-9")?.lineas.length, 1);
  assert.equal(m.size, 1);
});
