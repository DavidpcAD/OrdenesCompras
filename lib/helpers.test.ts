// Pruebas de las funciones puras que tocan CANTIDADES y MONTOS — las que si se
// rompen dan números mal en pantalla o en el PDF del proveedor, sin avisar.
//
// Corre con el runner que ya trae Node (sin dependencias nuevas):
//   npm test
// Node ≥23 le quita los tipos a los .ts solo, así que no hay paso de compilación.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ordenRecibidoPct, ordenEstaCompleta, ordenEsParcial, ordenAvance, ordenLineaImporte,
  ordenSubtotal, recibidoPorLineaPedido, recibidoDeLineaPedido, pedidoLineaPendiente,
  distribuirCargo, monedaApp, formatDate, todayISO, nextNumero, almacenesFisicos,
  ordenPedidos, ordenEsDirecta,
} from "./helpers.ts";
import type { Orden, OrdenLinea } from "./types.ts";

const linea = (p: Partial<OrdenLinea> & { id: string }): OrdenLinea => ({
  id: p.id, tipo: p.tipo ?? "articulo", descripcion: p.descripcion ?? "X",
  cantidad: p.cantidad ?? 0, unidad: p.unidad ?? "UND", almacen: p.almacen ?? "ALM-GRAL",
  precioUnitario: p.precioUnitario ?? 0, ivaPct: p.ivaPct ?? 13,
  cantidadRecibida: p.cantidadRecibida ?? 0, cantidadFacturada: p.cantidadFacturada ?? 0,
  descuentoPct: p.descuentoPct, pedidoLineaId: p.pedidoLineaId, chargeNo: p.chargeNo,
  pedidoNumero: p.pedidoNumero,
});

const orden = (lineas: OrdenLinea[]): Orden => ({
  id: "o1", numero: "CP-000001", proveedorId: "p1", fecha: "2026-08-17",
  currencyCode: "", estado: "lanzado", versionesArchivadas: 0, lineas,
});

// --- el flete no cuenta como material por recibir ----------------------------
// Regla del server: el saldo se mide con `tipoLinea='articulo'`. Si el cliente
// cuenta el cargo, una orden con flete nunca llega a 100% ni se completa.
test("el avance ignora las líneas de cargo", () => {
  const o = orden([
    linea({ id: "a", cantidad: 10, cantidadRecibida: 10, precioUnitario: 100 }),
    linea({ id: "f", tipo: "cargo", cantidad: 1, cantidadRecibida: 0, precioUnitario: 5000 }),
  ]);
  assert.equal(ordenRecibidoPct(o), 100);
  assert.equal(ordenEstaCompleta(o), true);
  assert.equal(ordenEsParcial(o), false);
  assert.deepEqual(ordenAvance(o), { recibida: 10, total: 10 });
});

test("recepción parcial: porcentaje sobre artículos", () => {
  const o = orden([
    linea({ id: "a", cantidad: 10, cantidadRecibida: 4 }),
    linea({ id: "b", cantidad: 10, cantidadRecibida: 0 }),
    linea({ id: "f", tipo: "cargo", cantidad: 1, cantidadRecibida: 0 }),
  ]);
  assert.equal(ordenRecibidoPct(o), 20);
  assert.equal(ordenEsParcial(o), true);
  assert.equal(ordenEstaCompleta(o), false);
});

test("orden sin líneas de artículo no está completa ni da NaN", () => {
  const o = orden([linea({ id: "f", tipo: "cargo", cantidad: 1 })]);
  assert.equal(ordenRecibidoPct(o), 0);
  assert.equal(ordenEstaCompleta(o), false);
});

// --- importes ---------------------------------------------------------------
test("el importe de línea aplica el descuento", () => {
  assert.equal(ordenLineaImporte(linea({ id: "a", cantidad: 10, precioUnitario: 1000 })), 10000);
  assert.equal(ordenLineaImporte(linea({ id: "a", cantidad: 10, precioUnitario: 1000, descuentoPct: 10 })), 9000);
});

test("el subtotal de la orden suma artículos y cargos, sin IVA", () => {
  const o = orden([
    linea({ id: "a", cantidad: 2, precioUnitario: 1000 }),
    linea({ id: "f", tipo: "cargo", cantidad: 1, precioUnitario: 500 }),
  ]);
  assert.equal(ordenSubtotal(o), 2500);
});

test("el cargo se reparte proporcional al importe de cada artículo", () => {
  const ls = [
    linea({ id: "a", cantidad: 1, precioUnitario: 3000 }),
    linea({ id: "b", cantidad: 1, precioUnitario: 1000 }),
    linea({ id: "f", tipo: "cargo", cantidad: 1, precioUnitario: 800 }),
  ];
  const rep = distribuirCargo(800, ls);
  assert.equal(rep["a"], 600);
  assert.equal(rep["b"], 200);
  assert.equal(rep["f"], undefined);          // el cargo no se reparte a sí mismo
  assert.equal(rep["a"] + rep["b"], 800);     // no se pierde ni se inventa plata
});

test("repartir un cargo sin base no explota", () => {
  assert.deepEqual(distribuirCargo(500, [linea({ id: "a", cantidad: 0, precioUnitario: 0 })]), {});
});

// --- saldos de solicitudes --------------------------------------------------
test("el índice de recibido por línea de pedido suma todas las órdenes", () => {
  const o1 = orden([
    linea({ id: "a", pedidoLineaId: "pl1", cantidadRecibida: 3 }),
    linea({ id: "b", cantidadRecibida: 99 }),               // sin pedidoLineaId: no cuenta
  ]);
  const o2 = orden([linea({ id: "c", pedidoLineaId: "pl1", cantidadRecibida: 2 })]);
  const idx = recibidoPorLineaPedido([o1, o2]);
  assert.equal(idx.get("pl1"), 5);
  assert.equal(idx.size, 1);
  // El índice debe coincidir con la función línea-a-línea que reemplaza.
  assert.equal(idx.get("pl1"), recibidoDeLineaPedido([o1, o2], "pl1"));
});

test("pendiente por ordenar nunca es negativo", () => {
  assert.equal(pedidoLineaPendiente({ id: "pl1", articuloId: "a", descripcion: "x", cantidad: 10, unidad: "UND", almacen: "", cantidadOrdenada: 12 }), 0);
  assert.equal(pedidoLineaPendiente({ id: "pl1", articuloId: "a", descripcion: "x", cantidad: 10, unidad: "UND", almacen: "", cantidadOrdenada: 4 }), 6);
});

// --- varios que ya mordieron antes -----------------------------------------
test("CRC se normaliza a vacío (si no, Moneda queda en 'Seleccioná…')", () => {
  assert.equal(monedaApp("CRC"), "");
  assert.equal(monedaApp("crc"), "");
  assert.equal(monedaApp("USD"), "USD");
  assert.equal(monedaApp(undefined), "");
});

test("una fecha solo-día no se corre al día anterior por zona horaria", () => {
  assert.equal(formatDate("2026-07-21"), "21/07/2026");
  assert.equal(formatDate("2026-07-21T00:00:00"), "21/07/2026");
  assert.equal(formatDate(""), "—");
});

test("todayISO usa la fecha LOCAL, no la UTC", () => {
  const d = new Date();
  const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(todayISO(), esperado);
});

test("el próximo número sigue al máximo existente", () => {
  assert.equal(nextNumero("CP", ["CP-000862", "CP-000863"]), "CP-000864");
  assert.equal(nextNumero("CP", []), "CP-000001");
  assert.equal(nextNumero("CP", ["basura"]), "CP-000001");
});

test("solo se ofrecen almacenes físicos ALM-*", () => {
  const list = [{ codigo: "ALM-GRAL" }, { codigo: "VN-M.28" }, { codigo: "alm-sso" }];
  assert.deepEqual(almacenesFisicos(list).map((a) => a.codigo), ["ALM-GRAL", "alm-sso"]);
});

test("las solicitudes de origen no repiten y las líneas manuales no cuentan", () => {
  const o = orden([
    linea({ id: "a", pedidoNumero: "PED-000118" }),
    linea({ id: "b", pedidoNumero: "PED-000118" }),   // misma solicitud: una sola vez
    linea({ id: "c", pedidoNumero: "Manual" }),        // agregada a mano: no es solicitud
    linea({ id: "d", pedidoNumero: "PED-000119" }),
  ]);
  assert.deepEqual(ordenPedidos(o), ["PED-000118", "PED-000119"]);
  assert.equal(ordenEsDirecta(o), false);
});

test("una orden con solo líneas manuales es directa", () => {
  const o = orden([linea({ id: "a", pedidoNumero: "Manual" }), linea({ id: "b" })]);
  assert.deepEqual(ordenPedidos(o), []);
  assert.equal(ordenEsDirecta(o), true);
});
