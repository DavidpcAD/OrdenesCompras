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
  distribuirCargo, monedaApp, formatDate, todayISO, nextNumero, almacenesParaRecepcion, esAlmacenFisico,
  ordenPedidos, ordenEsDirecta, money, pedidoOrdenadoPct, pedidoCompraBadge, pedidoTieneSaldo, ordenesPorPedido,
  destinoLabel, destinoCodigo, ordenLineaPendiente, ordenLineaCompleta, ultimoPrecioProveedor,
  ordenPendienteResumen, devolverPendienteAPedidos, proveedorLabel,
  numeroOrden, etiquetaInterna, tieneBc, esConsumoDirecto, obraParaOrden, destinoDeRecepcion,
  puedeDevolverLinea, motivoNoDevolver, ordenesDeLineaPedido, ordenEsBorradorDescartable,
  lineasACotizar, observacionesParaProveedor,
} from "./helpers.ts";
import type { Orden, OrdenLinea, Pedido, PedidoLinea } from "./types.ts";

const linea = (p: Partial<OrdenLinea> & { id: string }): OrdenLinea => ({
  id: p.id, tipo: p.tipo ?? "articulo", descripcion: p.descripcion ?? "X",
  cantidad: p.cantidad ?? 0, unidad: p.unidad ?? "UND", almacen: p.almacen ?? "ALM-GRAL",
  precioUnitario: p.precioUnitario ?? 0, ivaPct: p.ivaPct ?? 13,
  cantidadRecibida: p.cantidadRecibida ?? 0, cantidadFacturada: p.cantidadFacturada ?? 0,
  descuentoPct: p.descuentoPct, pedidoLineaId: p.pedidoLineaId, chargeNo: p.chargeNo,
  pedidoNumero: p.pedidoNumero, articuloId: p.articuloId,
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

test("una solicitud sabe en qué órdenes de compra entró (y al revés)", () => {
  // El enlace es N:M: PED-1 se repartió en dos órdenes, y CP-2 junta dos solicitudes.
  const p1 = { numero: "PED-1", lineas: [{ id: "l1" }, { id: "l2" }] } as any;
  const p2 = { numero: "PED-2", lineas: [{ id: "l9" }] } as any;
  const ordenes = [
    // Ya está en BC: se muestra su N.º de BC.
    { id: "o1", numero: "CP-000001", bcNumber: "CP-005101", lineas: [{ pedidoNumero: "PED-1" }] },
    // Todavía no está en BC y sin pedidoNumero: se resuelve por el id de la línea de
    // pedido, y se muestra el rótulo interno (nunca un CP- que allá no existe).
    { id: "o2", numero: "CP-000002", lineas: [{ pedidoLineaId: "l2" }, { pedidoLineaId: "l9" }] },
    // Directa: no aporta a ninguna solicitud.
    { id: "o3", numero: "CP-000003", lineas: [{ pedidoNumero: "Manual" }] },
  ] as any[];
  const m = ordenesPorPedido([p1, p2], ordenes);
  assert.deepEqual(m.get("PED-1")?.map((o) => o.numero), ["CP-005101", "Interno 2"]);
  assert.deepEqual(m.get("PED-2")?.map((o) => o.numero), ["Interno 2"]);
  assert.equal(m.size, 2);   // la directa no crea entradas
});

test("se ofrecen TODOS los centros de costo, con las bodegas primero", () => {
  const list = [{ codigo: "VN-M.28" }, { codigo: "ALM-GRAL" }, { codigo: "COM-MER" }, { codigo: "alm-sso" }];
  // Nadie se pierde (el material puede entrar a cualquier centro de costo) y las
  // bodegas ALM-* quedan arriba, que es donde se recibe casi siempre.
  assert.deepEqual(almacenesParaRecepcion(list).map((a) => a.codigo), ["ALM-GRAL", "alm-sso", "COM-MER", "VN-M.28"]);
  assert.equal(almacenesParaRecepcion(list).length, list.length);
  assert.equal(esAlmacenFisico("ALM-GRAL"), true);
  assert.equal(esAlmacenFisico("alm-sso"), true);   // no depende de mayúsculas
  assert.equal(esAlmacenFisico("VN-M.28"), false);
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

// --- helpers de pedido / formato -------------------------------------------
const pLinea = (p: Partial<PedidoLinea> & { id: string }): PedidoLinea => ({
  id: p.id, articuloId: p.articuloId ?? "a1", descripcion: p.descripcion ?? "X",
  cantidad: p.cantidad ?? 0, unidad: p.unidad ?? "UND", almacen: p.almacen ?? "",
  cantidadOrdenada: p.cantidadOrdenada ?? 0,
});
const pedido = (lineas: PedidoLinea[], extra: Partial<Pedido> = {}): Pedido => ({
  id: "p1", numero: "PED-000001", tipoSolicitud: "material", solicitante: "Laura",
  fecha: "2026-08-17", estado: "aprobado", prioridad: "normal", lineas, ...extra,
});

test("el % comprado de una solicitud no pasa de 100 aunque se ordene de más", () => {
  const p = pedido([pLinea({ id: "l1", cantidad: 10, cantidadOrdenada: 15 })]);
  assert.equal(pedidoOrdenadoPct(p), 100);
  assert.equal(pedidoCompraBadge(p).label, "100% ordenado");
  assert.equal(pedidoTieneSaldo(p), false);
});

test("solicitud a medio comprar: badge parcial y saldo pendiente", () => {
  const p = pedido([
    pLinea({ id: "l1", cantidad: 10, cantidadOrdenada: 4 }),
    pLinea({ id: "l2", cantidad: 10, cantidadOrdenada: 0 }),
  ]);
  assert.equal(pedidoOrdenadoPct(p), 20);
  assert.equal(pedidoCompraBadge(p).label, "Parcialmente ordenado");
  assert.equal(pedidoTieneSaldo(p), true);
});

test("el destino es la obra, o la máquina si es un repuesto", () => {
  const obra = pedido([], { obraCodigo: "OBRA-001", obraNombre: "Torre Escazú" });
  assert.equal(destinoCodigo(obra), "OBRA-001");
  assert.equal(destinoLabel(obra), "Torre Escazú");
  const rep = pedido([], { tipoSolicitud: "repuesto", maquinaNo: "MAQ-0012", maquinaNombre: "Excavadora" });
  assert.equal(destinoCodigo(rep), "MAQ-0012");
  assert.equal(destinoLabel(rep), "Excavadora");
});

test("pendiente de una línea de orden y línea completa", () => {
  assert.equal(ordenLineaPendiente(linea({ id: "a", cantidad: 10, cantidadRecibida: 4 })), 6);
  assert.equal(ordenLineaPendiente(linea({ id: "a", cantidad: 10, cantidadRecibida: 12 })), 0);
  assert.equal(ordenLineaCompleta(linea({ id: "a", cantidad: 10, cantidadRecibida: 10 })), true);
  assert.equal(ordenLineaCompleta(linea({ id: "a", cantidad: 10, cantidadRecibida: 9.999999999 })), true); // tolerancia
});

test("el último precio al proveedor toma la orden MÁS RECIENTE", () => {
  const vieja: Orden = { ...orden([linea({ id: "a", articuloId: "M1", precioUnitario: 100 })]), id: "o1", fecha: "2026-01-01" };
  const nueva: Orden = { ...orden([linea({ id: "b", articuloId: "M1", precioUnitario: 130 })]), id: "o2", fecha: "2026-08-01" };
  assert.equal(ultimoPrecioProveedor([vieja, nueva], "M1", "p1"), 130);
  assert.equal(ultimoPrecioProveedor([vieja, nueva], "M1", "otro"), null);   // otro proveedor
  assert.equal(ultimoPrecioProveedor([vieja, nueva], "M9", "p1"), null);     // artículo sin historial
});

test("money usa colones por defecto y respeta la moneda de la orden", () => {
  const crc = money(1000);
  assert.ok(crc.includes("\u20a1"), `esperaba el símbolo de colón en ${crc}`);
  assert.ok(/1.?000/.test(crc), `esperaba el monto en ${crc}`);
  assert.ok(money(1000, "USD").includes("USD"));       // es-CR escribe "USD 1 000,00"
  assert.equal(money(NaN), money(0));                  // no imprime "NaN"
  assert.equal(money(undefined as unknown as number), money(0));
});

// --- lo que queda sin recibir al cerrar una orden ----------------------------
// Es la cantidad que se le devuelve a las solicitudes: si se cuenta de más, el
// pedido queda con saldo que no existe; de menos, el material se pierde y hay que
// abrir una solicitud nueva para volver a comprarlo.
test("el resumen de pendiente ignora el flete y las líneas ya completas", () => {
  const o = orden([
    linea({ id: "a", cantidad: 10, cantidadRecibida: 10 }),      // completa: no cuenta
    linea({ id: "b", cantidad: 10, cantidadRecibida: 4 }),       // faltan 6
    linea({ id: "c", cantidad: 5, cantidadRecibida: 0 }),        // faltan 5
    linea({ id: "f", tipo: "cargo", cantidad: 1, cantidadRecibida: 0 }), // flete: no cuenta
  ]);
  assert.deepEqual(ordenPendienteResumen(o), { lineas: 2, unidades: 11 });
});

test("una orden recibida al 100% no tiene nada pendiente que devolver", () => {
  const o = orden([linea({ id: "a", cantidad: 3, cantidadRecibida: 3 })]);
  assert.deepEqual(ordenPendienteResumen(o), { lineas: 0, unidades: 0 });
});

// Recibir de más (pasa cuando el proveedor manda extra) no debe generar un
// pendiente NEGATIVO que le sume saldo fantasma a la solicitud.
test("recibir de más no genera pendiente negativo", () => {
  const o = orden([linea({ id: "a", cantidad: 10, cantidadRecibida: 12 })]);
  assert.deepEqual(ordenPendienteResumen(o), { lineas: 0, unidades: 0 });
});

// --- devolver el saldo a las solicitudes al cerrar ---------------------------
// Es plata y material: si se devuelve de menos, esas unidades no se pueden volver
// a comprar nunca; si se devuelve de más, la solicitud queda con saldo inventado y
// se compra dos veces.
const pedidoCon = (lineas: { id: string; cantidad: number; cantidadOrdenada: number }[]): Pedido => ({
  id: "p1", numero: "PED-000001", tipoSolicitud: "material", obraCodigo: "OB-1", solicitante: "Laura",
  fecha: "2026-07-01", estado: "en_orden", prioridad: "normal",
  lineas: lineas.map((l) => ({ id: l.id, descripcion: "X", cantidad: l.cantidad, unidad: "UND",
    almacen: "ALM-GRAL", cantidadOrdenada: l.cantidadOrdenada })),
} as unknown as Pedido);

test("cerrar devuelve solo lo NO recibido y reabre el saldo de la solicitud", () => {
  const ped = pedidoCon([{ id: "pl1", cantidad: 10, cantidadOrdenada: 10 }]);
  const o = orden([linea({ id: "a", pedidoLineaId: "pl1", cantidad: 10, cantidadRecibida: 4 })]);
  const [r] = devolverPendienteAPedidos([ped], o);
  assert.equal(r.lineas[0].cantidadOrdenada, 4);   // se devolvieron las 6 que no llegaron
  assert.equal(r.estado, "aprobado");              // vuelve a tener saldo por comprar
});

// El caso que rompe un UPDATE...JOIN ingenuo: dos líneas de la MISMA orden contra
// la misma línea de pedido. Hay que sumar los dos pendientes antes de restar.
test("dos líneas de la orden sobre la misma línea de pedido suman al devolver", () => {
  const ped = pedidoCon([{ id: "pl1", cantidad: 20, cantidadOrdenada: 20 }]);
  const o = orden([
    linea({ id: "a", pedidoLineaId: "pl1", cantidad: 10, cantidadRecibida: 2 }),   // faltan 8
    linea({ id: "b", pedidoLineaId: "pl1", cantidad: 10, cantidadRecibida: 3 }),   // faltan 7
  ]);
  const [r] = devolverPendienteAPedidos([ped], o);
  assert.equal(r.lineas[0].cantidadOrdenada, 5);   // 20 − (8 + 7)
});

test("una orden recibida completa no devuelve nada y deja la solicitud en orden", () => {
  const ped = pedidoCon([{ id: "pl1", cantidad: 10, cantidadOrdenada: 10 }]);
  const o = orden([linea({ id: "a", pedidoLineaId: "pl1", cantidad: 10, cantidadRecibida: 10 })]);
  const [r] = devolverPendienteAPedidos([ped], o);
  assert.equal(r.lineas[0].cantidadOrdenada, 10);
  assert.equal(r.estado, "en_orden");
});

test("el flete no devuelve saldo y las líneas sin solicitud no tocan nada", () => {
  const ped = pedidoCon([{ id: "pl1", cantidad: 10, cantidadOrdenada: 10 }]);
  const o = orden([
    linea({ id: "f", tipo: "cargo", pedidoLineaId: "pl1", cantidad: 1, cantidadRecibida: 0 }),
    linea({ id: "libre", cantidad: 5, cantidadRecibida: 0 }),   // compra directa, sin solicitud
  ]);
  const [r] = devolverPendienteAPedidos([ped], o);
  assert.equal(r.lineas[0].cantidadOrdenada, 10);
});

// Datos sucios (se recibió de más, o el saldo ya venía bajo): nunca dejar el
// consumo en negativo, que dispararía saldos fantasma en la solicitud.
test("nunca deja cantidadOrdenada negativa", () => {
  const ped = pedidoCon([{ id: "pl1", cantidad: 10, cantidadOrdenada: 2 }]);
  const o = orden([linea({ id: "a", pedidoLineaId: "pl1", cantidad: 10, cantidadRecibida: 0 })]);
  const [r] = devolverPendienteAPedidos([ped], o);
  assert.equal(r.lineas[0].cantidadOrdenada, 0);
});

// --- nombre del proveedor: nunca un "—" mudo --------------------------------
// Hay órdenes con proveedorNombre en NULL (las editadas antes del fix 8b8a5d3) y
// el catálogo de BC usa GUID como id mientras la orden trae el CÓDIGO: si solo se
// busca por id, la lista muestra "—" y no se sabe de quién es la orden.
const catalogo = [{ id: "guid-1", code: "PROV-000002", nombre: "3-101-054264 S.A." }];

test("usa el nombre guardado cuando está", () => {
  assert.equal(proveedorLabel({ proveedorNombre: "EPA", proveedorNo: "PROV-000522", proveedorId: "PROV-000522" }, catalogo), "EPA");
});

test("sin nombre lo resuelve por código contra el catálogo (no por id)", () => {
  assert.equal(
    proveedorLabel({ proveedorNombre: undefined, proveedorNo: "PROV-000002", proveedorId: "PROV-000002" }, catalogo),
    "3-101-054264 S.A.",
  );
});

test("sin catálogo cae al código, no a un guión", () => {
  assert.equal(proveedorLabel({ proveedorNombre: "", proveedorNo: "PROV-001023", proveedorId: "PROV-001023" }), "PROV-001023");
});

test("un nombre en blanco cuenta como ausente", () => {
  assert.equal(proveedorLabel({ proveedorNombre: "   ", proveedorNo: "PROV-000002", proveedorId: "PROV-000002" }, catalogo), "3-101-054264 S.A.");
});

test("sin nada devuelve el guión", () => {
  assert.equal(proveedorLabel({ proveedorNombre: undefined, proveedorNo: undefined, proveedorId: "" }), "—");
});

// ---- El N.º que se muestra: el de BC, o un rótulo que no se confunda con él ----
// El caso real (24 ago 2026): la app numera con MAX+1 sobre su propia tabla usando
// el MISMO prefijo CP- y los mismos 6 dígitos que la serie C PED de BC. En pantalla
// "CP-000037" (interno) y "CP-005156" (BC) se leían igual, y el interno no existe
// en Business Central.

test("numeroOrden: con N.º de BC gana el de BC", () => {
  assert.equal(numeroOrden({ numero: "CP-000037", bcNumber: "CP-005156" }), "CP-005156");
});

test("numeroOrden: sin N.º de BC NO se muestra algo que parezca de BC", () => {
  const r = numeroOrden({ numero: "CP-000037" });
  assert.equal(r, "Interno 37");
  assert.ok(!/^CP-/.test(r), "no puede empezar con CP-");
});

test("numeroOrden: bcNumber vacío o en blanco cuenta como sin BC", () => {
  assert.equal(numeroOrden({ numero: "CP-000037", bcNumber: "" }), "Interno 37");
});

test("etiquetaInterna: quita el prefijo y los ceros de relleno", () => {
  assert.equal(etiquetaInterna("CP-000001"), "Interno 1");
  assert.equal(etiquetaInterna("CP-000862"), "Interno 862");
  assert.equal(etiquetaInterna("cp-000037"), "Interno 37");
});

test("etiquetaInterna: un formato desconocido se devuelve tal cual", () => {
  // Datos migrados o de otra serie: adivinar sería peor que mostrarlos.
  assert.equal(etiquetaInterna("OC-2024-88"), "OC-2024-88");
  assert.equal(etiquetaInterna(""), "—");
});

test("tieneBc: distingue la orden que ya existe en BC", () => {
  assert.equal(tieneBc({ bcNumber: "CP-005156" }), true);
  assert.equal(tieneBc({ bcNumber: "  " }), false);
  assert.equal(tieneBc({}), false);
});

// ---- consumo directo: lo marca la TAREA, no la obra ---------------------------
// Un pedido de material SIEMPRE dice para qué obra es; solo el de consumo directo
// (CD) trae actividad. Mirar la obra sola metía en la orden un Job No. sin tarea y
// BC no podía lanzar el pedido.
test("esConsumoDirecto: la tarea es la que manda", () => {
  assert.equal(esConsumoDirecto({ taskNo: "2.2" }), true);
  assert.equal(esConsumoDirecto({ taskNo: "" }), false);
  assert.equal(esConsumoDirecto({ taskNo: "  " }), false);
  assert.equal(esConsumoDirecto({}), false);
});

test("obraParaOrden: sin tarea la obra NO viaja a la orden", () => {
  assert.equal(obraParaOrden({ proyecto: "VN-L.20", taskNo: "2.2" }), "VN-L.20");
  assert.equal(obraParaOrden({ proyecto: "F-MAD-NUE" }), "");
  assert.equal(obraParaOrden({}), "");
});

// ---- a dónde fue el material de una factura ------------------------------------
// El stock sube solo con lo que entró al almacén: lo que va contra una obra BC lo
// consume en el mismo movimiento. La factura puede traer las dos cosas.
test("destinoDeRecepcion: separa el consumo de obra de lo que entra al almacén", () => {
  const orden = {
    lineas: [
      { id: "l1", tipo: "articulo", proyecto: "VN-L.20", almacen: "VN-L.20" },
      { id: "l2", tipo: "articulo", almacen: "ALM-GRAL" },
      { id: "l3", tipo: "cargo", almacen: "ALM-GRAL" },      // el flete no es material
      { id: "l4", tipo: "articulo", proyecto: "VN-L.20", almacen: "VN-L.20" },
    ] as any,
  };
  const d = destinoDeRecepcion({ lineas: [
    { ordenLineaId: "l1", cantidadRecibida: 5 },
    { ordenLineaId: "l2", cantidadRecibida: 3 },
    { ordenLineaId: "l3", cantidadRecibida: 1 },
    { ordenLineaId: "l4", cantidadRecibida: 2 },
  ] }, orden);
  assert.deepEqual(d, { obras: ["VN-L.20"], almacenes: ["ALM-GRAL"] });
});

test("destinoDeRecepcion: una línea sin recibir no cuenta", () => {
  const orden = { lineas: [{ id: "l1", tipo: "articulo", almacen: "ALM-GRAL" }] as any };
  assert.deepEqual(destinoDeRecepcion({ lineas: [{ ordenLineaId: "l1", cantidadRecibida: 0 }] }, orden),
    { obras: [], almacenes: [] });
});

// ---- devolución POR LÍNEA al ingeniero ------------------------------------------
// Lo que Proveeduría ya convirtió en orden de compra NO se devuelve: ese material
// ya se le pidió al proveedor y devolverlo dejaría a Ingeniería creyendo que no.
const lineaPed = (p: Partial<PedidoLinea> = {}): PedidoLinea => ({
  id: "pl1", articuloId: "M01-0001", descripcion: "CEMENTO", cantidad: 10, unidad: "UND",
  almacen: "ALM-GRAL", cantidadOrdenada: 0, ...p,
});

test("puedeDevolverLinea: solo lo que no tiene orden y no está devuelto", () => {
  assert.equal(puedeDevolverLinea(lineaPed()), true);
  assert.equal(puedeDevolverLinea(lineaPed({ cantidadOrdenada: 4 })), false);
  assert.equal(puedeDevolverLinea(lineaPed({ devuelta: true })), false);
});

test("motivoNoDevolver: dice por qué la casilla está apagada", () => {
  assert.equal(motivoNoDevolver(lineaPed()), "");
  assert.match(motivoNoDevolver(lineaPed({ cantidadOrdenada: 1 })), /orden de compra/);
  assert.match(motivoNoDevolver(lineaPed({ devuelta: true })), /devuelta/);
});

// La línea devuelta queda BLOQUEADA: sin pendiente, desaparece de "materiales por
// línea", de "+ De solicitudes" y del saldo del pedido.
test("una línea devuelta no tiene pendiente aunque le sobre cantidad", () => {
  assert.equal(pedidoLineaPendiente(lineaPed({ cantidad: 10, cantidadOrdenada: 0 })), 10);
  assert.equal(pedidoLineaPendiente(lineaPed({ cantidad: 10, cantidadOrdenada: 0, devuelta: true })), 0);
});

// ---- qué orden se llevó una línea de la solicitud -------------------------------
// "No se puede devolver" a secas manda a Proveeduría a abrir orden por orden. El
// mensaje tiene que nombrar la orden y, si todavía es un borrador, decir cómo
// soltar el material.
const ordenConLinea = (p: Partial<Orden> & { id: string }, pedidoLineaId: string, cantidad = 5): Orden => ({
  id: p.id, numero: p.numero ?? `CP-00000${p.id}`, proveedorId: "PROV-1", fecha: "2026-08-25",
  currencyCode: "", estado: p.estado ?? "abierto", versionesArchivadas: 0, bcNumber: p.bcNumber,
  lineas: [{
    id: `ol-${p.id}`, tipo: "articulo", articuloId: "M01", descripcion: "PERLING", cantidad,
    unidad: "UND", almacen: "ALM-GRAL", precioUnitario: 100, ivaPct: 13,
    cantidadRecibida: 0, cantidadFacturada: 0, pedidoLineaId,
  }],
});

test("ordenesDeLineaPedido: encuentra las órdenes por pedidoLineaId y suma la cantidad", () => {
  const ords = [ordenConLinea({ id: "1" }, "pl9", 5), ordenConLinea({ id: "2" }, "otra", 3), ordenConLinea({ id: "3", bcNumber: "CP-005192", estado: "pendiente_aprobacion" }, "pl9", 2)];
  const r = ordenesDeLineaPedido(ords, "pl9");
  assert.equal(r.length, 2);
  assert.equal(r[0].cantidad, 5);
  assert.equal(r[0].enBc, false);
  assert.equal(r[1].etiqueta, "CP-005192");   // con N.º de BC se muestra ese, no el interno
  assert.equal(r[1].enBc, true);
});

test("ordenEsBorradorDescartable: solo abierta/rechazada y sin N.º de BC", () => {
  assert.equal(ordenEsBorradorDescartable({ estado: "abierto" }), true);
  assert.equal(ordenEsBorradorDescartable({ estado: "rechazado" }), true);
  assert.equal(ordenEsBorradorDescartable({ estado: "abierto", bcNumber: "CP-005192" }), false);
  assert.equal(ordenEsBorradorDescartable({ estado: "lanzado" }), false);
});

test("motivoNoDevolver: si la retiene un borrador, dice cómo liberarla", () => {
  const l = lineaPed({ id: "pl9", cantidadOrdenada: 5 });
  const soloBorrador = motivoNoDevolver(l, [ordenConLinea({ id: "1", numero: "CP-000070" }, "pl9")]);
  assert.match(soloBorrador, /Interno 70/);
  assert.match(soloBorrador, /descartá/i);
  // Con una orden que YA está en BC no hay atajo: se nombra y punto.
  const enBc = motivoNoDevolver(l, [ordenConLinea({ id: "2", bcNumber: "CP-005192", estado: "lanzado" }, "pl9")]);
  assert.match(enBc, /CP-005192/);
  assert.doesNotMatch(enBc, /descartá/i);
});

test("motivoNoDevolver: una orden cerrada no tapa el consejo del borrador", () => {
  const l = lineaPed({ id: "pl9", cantidadOrdenada: 5 });
  const m = motivoNoDevolver(l, [
    ordenConLinea({ id: "9", numero: "CP-000009", estado: "completado" }, "pl9"),
    ordenConLinea({ id: "1", numero: "CP-000070" }, "pl9"),
  ]);
  assert.match(m, /descartá/i);
  assert.match(m, /Interno 70/);
});

test("motivoNoDevolver: sin la lista de órdenes sigue dando el motivo corto", () => {
  assert.equal(motivoNoDevolver(lineaPed({ cantidadOrdenada: 3 })), "ya tiene orden de compra");
});

// ---- el motivo de la devolución NO puede salir en el PDF del proveedor ----------
// `notaCreador` hace doble oficio (comentario del ingeniero + motivo de la
// devolución, que es como lo ven las dos apps). El PDF de cotización imprime ese
// campo como "Observaciones": sin recortar, el proveedor recibía el motivo interno.
test("observacionesParaProveedor: recorta el prefijo de la devolución", () => {
  assert.equal(
    observacionesParaProveedor("↩ Devuelta(s): CEMENTO 50KG — pidió de más · Tapia prefabricada Central AD"),
    "Tapia prefabricada Central AD",
  );
  assert.equal(observacionesParaProveedor("↩ Devuelto: no hay presupuesto"), "");
  assert.equal(observacionesParaProveedor("Tapia prefabricada Central AD"), "Tapia prefabricada Central AD");
  assert.equal(observacionesParaProveedor(undefined), "");
});

// El fallback "si no hay pendiente, cotizá todo" no puede resucitar lo devuelto.
test("lineasACotizar: sin pendiente cotiza el resto, nunca lo devuelto", () => {
  const ped = {
    id: "p1", numero: "PED-000123", tipoSolicitud: "material" as const, solicitante: "Laura",
    fecha: "2026-08-25", estado: "aprobado" as const, prioridad: "normal" as const,
    lineas: [
      lineaPed({ id: "a", cantidad: 5, cantidadOrdenada: 5 }),
      lineaPed({ id: "b", cantidad: 7, cantidadOrdenada: 0, devuelta: true }),
    ],
  };
  const r = lineasACotizar(ped);
  assert.equal(r.length, 1);
  assert.equal(r[0].linea.id, "a");
});
