// "LO QUE ESTÁ EN TU CANCHA" — el panel que Angie mira varias veces al día para
// saber qué le toca hoy. Si una de las cinco paradas cuenta de más o de menos,
// nadie se da cuenta: no hay error en pantalla, simplemente se trabaja sobre una
// lista equivocada. Lo que cuidan estas pruebas son los cuatro cruces donde eso
// puede pasar en silencio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loQueEstaEnTuCancha } from "./compras-cancha.ts";
import type { Orden, OrdenLinea, Pedido, PedidoLinea } from "./types.ts";

const linea = (o: Partial<OrdenLinea> = {}): OrdenLinea => ({
  id: "l1", tipo: "articulo", articuloId: "M01-0001", descripcion: "Material",
  cantidad: 10, unidad: "UND", almacen: "ALM-GRAL", precioUnitario: 100, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0, ...o,
} as OrdenLinea);

const orden = (o: Partial<Orden> = {}): Orden => ({
  id: "1", numero: "CP-000001", proveedorId: "PROV-001", fecha: "2026-05-10",
  currencyCode: "", estado: "abierto", lineas: [linea()], ...o,
} as Orden);

const pLinea = (o: Partial<PedidoLinea> = {}): PedidoLinea => ({
  id: "pl1", articuloId: "M01-0001", descripcion: "Material", cantidad: 10,
  unidad: "UND", cantidadOrdenada: 0, ...o,
} as PedidoLinea);

const pedido = (o: Partial<Pedido> = {}): Pedido => ({
  id: "1", numero: "PED-000001", fecha: "2026-05-01", estado: "aprobado",
  lineas: [pLinea()], ...o,
} as Pedido);

const de = (items: ReturnType<typeof loQueEstaEnTuCancha>, clave: string) => items.find((i) => i.clave === clave);

test("la plata de otra moneda NO se suma a la del panel", () => {
  // Una orden en dólares en el panel de colones sumaría 2000 colones que no existen.
  const items = loQueEstaEnTuCancha([
    orden({ id: "1", lineas: [linea({ cantidad: 1, precioUnitario: 1000 })] }),
    orden({ id: "2", currencyCode: "USD", lineas: [linea({ cantidad: 1, precioUnitario: 2000 })] }),
  ], [], "CRC");
  assert.equal(de(items, "abierto")?.cuenta, 1);
  assert.equal(de(items, "abierto")?.monto, 1000);
});

test("una orden abierta que espera al ingeniero NO cuenta como abierta", () => {
  // El cruce más fácil de romper: `esperan` y `abiertas` se sacan de la misma lista.
  // Espera corrección = ya está en BC y se quedó sin nada que comprar.
  const vacia = orden({ id: "9", estado: "abierto", bcNumber: "CP-005000", lineas: [linea({ tipo: "cargo" })] });
  const items = loQueEstaEnTuCancha([vacia], [], "CRC");
  assert.equal(de(items, "abierto"), undefined, "no debería figurar como abierta");
  assert.equal(de(items, "espera")?.cuenta, 1);
});

test("la aprobada que YA se completó no sigue colgando de 'sin mandarle al proveedor'", () => {
  // Si llegó todo el material, que el PDF nunca saliera dejó de ser un problema.
  const items = loQueEstaEnTuCancha([
    orden({ id: "1", estado: "lanzado" }),                     // lanzada y sin enviar → cuenta
    orden({ id: "2", estado: "completado" }),                  // ya llegó todo → no cuenta
    orden({ id: "3", estado: "lanzado", envioProveedor: { fecha: "2026-05-11", usuario: "Angie" } }),
  ], [], "CRC");
  assert.equal(de(items, "sin-mandar")?.cuenta, 1);
});

test("el importe excluye el flete y respeta el descuento", () => {
  // Contar el cargo infla la parada: el flete no es material que se compró.
  const items = loQueEstaEnTuCancha([orden({
    lineas: [
      linea({ id: "a", cantidad: 2, precioUnitario: 1000, descuentoPct: 10 }),  // 1800
      linea({ id: "b", tipo: "cargo", cantidad: 1, precioUnitario: 5000 }),     // no suma
    ],
  })], [], "CRC");
  assert.equal(de(items, "abierto")?.monto, 1800);
});

test("solicitudes sin orden: no entran las de borrador, devueltas ni cerradas", () => {
  const items = loQueEstaEnTuCancha([], [
    pedido({ id: "1", estado: "aprobado" }),    // cuenta
    pedido({ id: "2", estado: "borrador" }),
    pedido({ id: "3", estado: "devuelto" }),
    pedido({ id: "4", estado: "cerrado" }),
  ], "CRC");
  assert.equal(de(items, "sin-orden")?.cuenta, 1);
});

test("la solicitud que ya tiene algo ordenado deja de estar sin orden", () => {
  const items = loQueEstaEnTuCancha([], [
    pedido({ id: "1", lineas: [pLinea({ cantidad: 10, cantidadOrdenada: 1 })] }),
  ], "CRC");
  assert.equal(de(items, "sin-orden"), undefined);
});

test("lo que está en cero no se dibuja: sin nada pendiente el panel viene vacío", () => {
  assert.deepEqual(loQueEstaEnTuCancha([], [], "CRC"), []);
});
