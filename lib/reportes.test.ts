// Pruebas de la aritmética de los reportes. Son los números con los que se
// negocia un precio con el proveedor y se le cobra a una obra: si un promedio
// mezcla monedas o un total se come las órdenes en borrador, la decisión sale mal
// y nada en pantalla lo delata.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { filasDeCompra, porMaterial, agruparPor, importeLinea, aCsv, opcionesDeFiltro } from "./reportes.ts";
import type { Orden, OrdenLinea, Pedido } from "./types.ts";

const linea = (p: Partial<OrdenLinea> & { id: string }): OrdenLinea => ({
  id: p.id, tipo: p.tipo ?? "articulo", descripcion: p.descripcion ?? "CEMENTO",
  articuloId: p.articuloId ?? "M01-0001", cantidad: p.cantidad ?? 1, unidad: p.unidad ?? "UND",
  almacen: p.almacen ?? "ALM-GRAL", precioUnitario: p.precioUnitario ?? 0, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0, descuentoPct: p.descuentoPct,
  proyecto: p.proyecto, pedidoNumero: p.pedidoNumero, pedidoLineaId: p.pedidoLineaId,
});

const orden = (p: Partial<Orden> & { id: string; lineas: OrdenLinea[] }): Orden => ({
  id: p.id, numero: p.numero ?? `CP-${p.id}`, proveedorId: "p1",
  proveedorNo: p.proveedorNo ?? "PROV-001", proveedorNombre: p.proveedorNombre ?? "FERRETERIA EPA",
  fecha: p.fecha ?? "2026-08-01", currencyCode: p.currencyCode ?? "", estado: p.estado ?? "lanzado",
  versionesArchivadas: 0, creadoPor: p.creadoPor ?? "Angie", bcNumber: p.bcNumber, lineas: p.lineas,
});

const pedido = (numero: string, solicitante: string, obraCodigo: string, lineaId: string): Pedido => ({
  id: `p-${numero}`, numero, tipoSolicitud: "material", obraCodigo, solicitante, fecha: "2026-07-01",
  estado: "aprobado", prioridad: "normal",
  lineas: [{ id: lineaId, descripcion: "CEMENTO", cantidad: 1, unidad: "UND", almacen: "ALM-GRAL", cantidadOrdenada: 0 }],
} as unknown as Pedido);

// Un repuesto no va a una obra sino a una máquina: también es centro de costo.
const pedidoRepuesto = (numero: string, solicitante: string, maquinaNo: string, lineaId: string): Pedido => ({
  id: `p-${numero}`, numero, tipoSolicitud: "repuesto", maquinaNo, solicitante, fecha: "2026-07-01",
  estado: "aprobado", prioridad: "normal",
  lineas: [{ id: lineaId, descripcion: "FILTRO", cantidad: 1, unidad: "UND", almacen: "ALM-GRAL", cantidadOrdenada: 0 }],
} as unknown as Pedido);

// --- una orden en borrador NO es una compra ----------------------------------
// Si contaran, el historial de precios mostraría precios que nadie pagó y el
// total por obra incluiría plata que todavía no se comprometió.
test("por defecto solo cuentan las órdenes lanzadas o completadas", () => {
  const ords = [
    orden({ id: "1", estado: "lanzado", lineas: [linea({ id: "a", cantidad: 2, precioUnitario: 100 })] }),
    orden({ id: "2", estado: "abierto", lineas: [linea({ id: "b", cantidad: 5, precioUnitario: 999 })] }),
    orden({ id: "3", estado: "rechazado", lineas: [linea({ id: "c", cantidad: 5, precioUnitario: 999 })] }),
    orden({ id: "4", estado: "completado", lineas: [linea({ id: "d", cantidad: 3, precioUnitario: 100 })] }),
  ];
  assert.equal(filasDeCompra(ords, []).length, 2);
  assert.equal(filasDeCompra(ords, [], { incluirNoAprobadas: true }).length, 4);
});

// --- el flete no es un material ----------------------------------------------
test("las líneas de cargo quedan fuera del historial de compras", () => {
  const o = orden({ id: "1", lineas: [
    linea({ id: "a", cantidad: 2, precioUnitario: 100 }),
    linea({ id: "f", tipo: "cargo", descripcion: "FLETE", cantidad: 1, precioUnitario: 45000 }),
  ] });
  const filas = filasDeCompra([o], []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].descripcion, "CEMENTO");
});

// --- el descuento de línea cuenta -------------------------------------------
test("el importe aplica el descuento de línea", () => {
  assert.equal(importeLinea(10, 1000, 0), 10000);
  assert.equal(importeLinea(10, 1000, 10), 9000);
  assert.equal(importeLinea(0, 1000, 10), 0);
});

// --- quién pidió y quién compró ---------------------------------------------
// Es la pregunta concreta del reporte: el solicitante sale de la solicitud de
// origen (por línea o por número) y el comprador del creador de la orden.
test("resuelve solicitante desde la solicitud y comprador desde la orden", () => {
  const ped = pedido("PED-000041", "Laura", "VN-M.02", "pl1");
  const o = orden({ id: "1", creadoPor: "Angie", lineas: [linea({ id: "a", pedidoLineaId: "pl1", cantidad: 1, precioUnitario: 10 })] });
  const [f] = filasDeCompra([o], [ped]);
  assert.equal(f.solicitante, "Laura");
  assert.equal(f.compradorOC, "Angie");
  assert.equal(f.pedidoNumero, "PED-000041");
  // La obra de la línea manda; si no la trae, cae a la de la solicitud.
  assert.equal(f.obra, "VN-M.02");
});

test("en repuestos el centro de costo es la máquina", () => {
  const ped = pedidoRepuesto("PED-000050", "Pedro", "MAQ-0012", "pl9");
  const o = orden({ id: "1", lineas: [linea({ id: "a", pedidoLineaId: "pl9" })] });
  assert.equal(filasDeCompra([o], [ped])[0].obra, "MAQ-0012");
});

test("la obra de la línea gana sobre la de la solicitud", () => {
  const ped = pedido("PED-000041", "Laura", "VN-M.02", "pl1");
  const o = orden({ id: "1", lineas: [linea({ id: "a", pedidoLineaId: "pl1", proyecto: "DA-1998" })] });
  assert.equal(filasDeCompra([o], [ped])[0].obra, "DA-1998");
});

// --- historial de precios por material --------------------------------------
test("por material: veces compradas, precios y último proveedor", () => {
  const ords = [
    orden({ id: "1", numero: "CP-1", fecha: "2026-01-10", proveedorNombre: "EPA",
      lineas: [linea({ id: "a", articuloId: "M01", cantidad: 10, precioUnitario: 1000 })] }),
    orden({ id: "2", numero: "CP-2", fecha: "2026-06-10", proveedorNombre: "TECNIBRE",
      lineas: [linea({ id: "b", articuloId: "M01", cantidad: 30, precioUnitario: 1200 })] }),
    // Misma orden, dos líneas del mismo material: son 2 líneas pero UNA compra.
    orden({ id: "3", numero: "CP-3", fecha: "2026-08-10", proveedorNombre: "EPA",
      lineas: [
        linea({ id: "c", articuloId: "M01", cantidad: 5, precioUnitario: 900 }),
        linea({ id: "d", articuloId: "M01", cantidad: 5, precioUnitario: 900 }),
      ] }),
  ];
  const [g] = porMaterial(filasDeCompra(ords, []));
  assert.equal(g.ordenes, 3);
  assert.equal(g.lineas, 4);
  assert.equal(g.cantidad, 50);
  assert.equal(g.precioMin, 900);
  assert.equal(g.precioMax, 1200);
  // Ponderado por cantidad, no promedio simple: (10·1000 + 30·1200 + 10·900) / 50
  assert.equal(g.precioPromedio, 1100);
  assert.equal(g.ultimoPrecio, 900);
  assert.equal(g.ultimoProveedor, "EPA");
  assert.deepEqual(g.proveedores.sort(), ["EPA", "TECNIBRE"]);
});

// --- monedas: no se suman ni se promedian juntas -----------------------------
// Un "precio promedio" que mezcla ₡ con $ es un número inventado. Se separan los
// totales y la estadística se calcula sobre la moneda de la última compra.
test("colones y dólares se reportan por separado", () => {
  const ords = [
    orden({ id: "1", fecha: "2026-01-10", currencyCode: "USD", lineas: [linea({ id: "a", cantidad: 2, precioUnitario: 100 })] }),
    orden({ id: "2", fecha: "2026-08-10", currencyCode: "", lineas: [linea({ id: "b", cantidad: 2, precioUnitario: 50000 })] }),
  ];
  const [g] = porMaterial(filasDeCompra(ords, []));
  assert.equal(g.monedasMezcladas, true);
  assert.equal(g.importePorMoneda["USD"], 200);
  assert.equal(g.importePorMoneda[""], 100000);
  // La última compra fue en colones: las estadísticas son de esa moneda.
  assert.equal(g.moneda, "");
  assert.equal(g.precioPromedio, 50000);
  assert.equal(g.precioMax, 50000);
});

// --- centro de costo ---------------------------------------------------------
test("agrupar por obra suma por centro de costo y no pierde las líneas sin obra", () => {
  const ords = [
    orden({ id: "1", lineas: [
      linea({ id: "a", proyecto: "VN-M.02", cantidad: 1, precioUnitario: 1000 }),
      linea({ id: "b", proyecto: "VN-M.02", articuloId: "M02", cantidad: 1, precioUnitario: 500 }),
      linea({ id: "c", cantidad: 1, precioUnitario: 300 }),
    ] }),
  ];
  const g = agruparPor(filasDeCompra(ords, []), "obra");
  assert.equal(g.length, 2);
  assert.equal(g[0].clave, "VN-M.02");
  assert.equal(g[0].importePorMoneda[""], 1500);
  assert.equal(g[0].materiales, 2);
  assert.equal(g[0].ordenes, 1);
  assert.equal(g[1].clave, "(sin asignar)");
  assert.equal(g[1].importePorMoneda[""], 300);
});

// --- filtros -----------------------------------------------------------------
test("filtra por rango de fechas incluyendo los extremos", () => {
  const ords = [
    orden({ id: "1", fecha: "2026-01-01T08:00:00", lineas: [linea({ id: "a" })] }),
    orden({ id: "2", fecha: "2026-06-15", lineas: [linea({ id: "b" })] }),
    orden({ id: "3", fecha: "2026-12-31T23:59:00", lineas: [linea({ id: "c" })] }),
  ];
  assert.equal(filasDeCompra(ords, [], { desde: "2026-01-01", hasta: "2026-12-31" }).length, 3);
  assert.equal(filasDeCompra(ords, [], { desde: "2026-02-01" }).length, 2);
  assert.equal(filasDeCompra(ords, [], { hasta: "2026-06-15" }).length, 2);
});

test("el texto busca por código y por descripción", () => {
  const o = orden({ id: "1", lineas: [
    linea({ id: "a", articuloId: "M20-0141", descripcion: "FILTRO DE ACEITE" }),
    linea({ id: "b", articuloId: "M09-0027", descripcion: "MELAMINA 18MM" }),
  ] });
  assert.equal(filasDeCompra([o], [], { texto: "m20" }).length, 1);
  assert.equal(filasDeCompra([o], [], { texto: "melamina" }).length, 1);
  assert.equal(filasDeCompra([o], [], { texto: "aceite" })[0].itemNo, "M20-0141");
  assert.equal(filasDeCompra([o], [], { texto: "no existe" }).length, 0);
});

// --- filtros: las opciones incluyen también lo no aprobado --------------------
// Si el desplegable se armara solo con lo comprado, al marcar "incluir no
// aprobadas" habría filas de obras que el filtro ni ofrece.
test("las opciones de filtro salen de todas las órdenes", () => {
  const ords = [
    orden({ id: "1", estado: "abierto", proveedorNo: "PROV-9", proveedorNombre: "NUEVA",
      lineas: [linea({ id: "a", proyecto: "OBRA-Z" })] }),
    orden({ id: "2", estado: "lanzado", lineas: [linea({ id: "b", proyecto: "OBRA-A" })] }),
  ];
  const { obras, proveedores } = opcionesDeFiltro(ords, []);
  assert.deepEqual(obras, ["OBRA-A", "OBRA-Z"]);
  assert.equal(proveedores.length, 2);
});

// --- CSV ---------------------------------------------------------------------
test("el CSV escapa el separador y lleva BOM para el Excel en español", () => {
  const o = orden({ id: "1", proveedorNombre: "EPA; S.A.", lineas: [linea({ id: "a", cantidad: 1.5, precioUnitario: 1000 })] });
  const csv = aCsv(filasDeCompra([o], []));
  assert.ok(csv.startsWith("﻿"), "falta el BOM");
  const [cab, fila] = csv.slice(1).split("\r\n");
  assert.ok(cab.startsWith("Fecha;Orden;"));
  assert.ok(fila.includes('"EPA; S.A."'), "el proveedor con ; debe ir entre comillas");
  assert.ok(fila.includes("1,5"), "los decimales van con coma");
});
