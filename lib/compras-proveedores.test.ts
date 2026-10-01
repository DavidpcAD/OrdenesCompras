// "A QUIÉN HAY QUE CORRETEARLE" — lo pedido contra lo entregado, por proveedor.
// Alimenta dos cosas a la vez (la barra de plata del encabezado y la tabla de la
// pestaña), así que un error acá se ve doble y no se nota en ninguno de los dos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenPorProveedor } from "./compras-proveedores.ts";
import type { Orden, OrdenLinea, Proveedor } from "./types.ts";

const linea = (o: Partial<OrdenLinea> = {}): OrdenLinea => ({
  id: "l1", tipo: "articulo", articuloId: "M01-0001", descripcion: "Material",
  cantidad: 10, unidad: "UND", almacen: "ALM-GRAL", precioUnitario: 100, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0, ...o,
} as OrdenLinea);

const orden = (o: Partial<Orden> = {}): Orden => ({
  id: "1", numero: "CP-000001", proveedorId: "PROV-001", fecha: "2026-05-10",
  currencyCode: "", estado: "lanzado", lineas: [linea()], ...o,
} as Orden);

const prov = (o: Partial<Proveedor> = {}): Proveedor =>
  ({ id: "PROV-001", code: "PROV-001", nombre: "FERRETERIA EPA S.A", ...o });

test("el mismo proveedor con distinto id NO sale en dos filas", () => {
  // El id de la app es el CÓDIGO (PROV-…) y el catálogo de BC usa GUID: sin la
  // clave normalizada, "FERRETERIA EPA S.A" aparecía repetida y la plata partida.
  const r = resumenPorProveedor([
    orden({ id: "1", proveedorId: "PROV-001", proveedorNombre: "FERRETERIA EPA S.A" }),
    orden({ id: "2", proveedorId: "guid-raro-de-bc", proveedorNombre: "ferreteria  epa  s.a" }),
  ], []);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].nOrdenes, 2);
});

test("el código de proveedor manda sobre el nombre para agrupar", () => {
  const r = resumenPorProveedor([
    orden({ id: "1", proveedorNo: "PROV-77", proveedorNombre: "TECNIBRE S.A." }),
    orden({ id: "2", proveedorNo: "PROV-77", proveedorNombre: "Tecnibre Sociedad Anónima" }),
  ], []);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].proveedorId, "PROV-77");
});

test("la antigüedad sale de la orden más vieja que TODAVÍA debe, no de la más vieja", () => {
  // Una orden vieja ya completa no puede seguir acusando al proveedor.
  const r = resumenPorProveedor([
    orden({ id: "1", fecha: "2025-01-01", lineas: [linea({ cantidad: 10, cantidadRecibida: 10 })] }), // saldada
    orden({ id: "2", fecha: "2026-03-15", lineas: [linea({ cantidad: 10, cantidadRecibida: 2 })] }),  // debe
  ], []);
  assert.equal(r.filas[0].desdeISO, "2026-03-15");
});

test("el proveedor que ya entregó todo no arrastra fecha", () => {
  const r = resumenPorProveedor([
    orden({ lineas: [linea({ cantidad: 5, cantidadRecibida: 5 })] }),
  ], []);
  assert.equal(r.filas[0].desdeISO, null);
  assert.equal(r.filas[0].pendiente, 0);
  assert.equal(r.filas[0].pct, 100);
});

test("el flete no cuenta, el recurso y el activo fijo sí", () => {
  // Dejar fuera el recurso descuadraba el total del proveedor contra el de la orden.
  const r = resumenPorProveedor([orden({
    lineas: [
      linea({ id: "a", tipo: "articulo", cantidad: 1, precioUnitario: 1000 }),
      linea({ id: "b", tipo: "recurso", cantidad: 1, precioUnitario: 500 }),
      linea({ id: "c", tipo: "activo_fijo", cantidad: 1, precioUnitario: 300 }),
      linea({ id: "d", tipo: "cargo", cantidad: 1, precioUnitario: 9999 }),
    ],
  })], []);
  assert.equal(r.filas[0].pedido, 1800);
  assert.equal(r.filas[0].lineas.length, 3);
});

test("primero el que más plata debe", () => {
  const r = resumenPorProveedor([
    orden({ id: "1", proveedorNo: "A", lineas: [linea({ cantidad: 1, precioUnitario: 100 })] }),
    orden({ id: "2", proveedorNo: "B", lineas: [linea({ cantidad: 1, precioUnitario: 9000 })] }),
  ], []);
  assert.deepEqual(r.filas.map((f) => f.proveedorId), ["B", "A"]);
});

test("sin órdenes no se divide entre cero", () => {
  const r = resumenPorProveedor([], [prov()]);
  assert.deepEqual(r, { filas: [], pedido: 0, recibido: 0, pendiente: 0, pct: 0 });
});

test("el descuento de la línea viaja al total del proveedor", () => {
  const r = resumenPorProveedor([orden({
    lineas: [linea({ cantidad: 2, precioUnitario: 1000, descuentoPct: 25, cantidadRecibida: 1 })],
  })], []);
  assert.equal(r.filas[0].pedido, 1500);   // 2 × 1000 − 25 %
  assert.equal(r.filas[0].recibido, 750);  // 1 × 1000 − 25 %
  assert.equal(r.filas[0].pct, 50);
});
