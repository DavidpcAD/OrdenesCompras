// Los montos del Resumen, con órdenes en varias monedas.
//
// Lo que cuidan estas pruebas es que NADA se sume mal y que NADA se caiga en
// silencio: hasta el 22/09/2026 el Resumen mostraba solo la moneda con más órdenes y
// dejaba 23 en dólares y 1 en euros afuera del total. Ahora se convierten con el
// tipo de cambio de BC, y si falta el factor de una moneda esa orden queda fuera pero
// SE DICE (ver `kpisDeCompras`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kpisDeCompras } from "./compras-kpis.ts";
import { factorDeCambio } from "./bc.ts";
import type { Orden, OrdenLinea } from "./types.ts";

const linea = (o: Partial<OrdenLinea> = {}): OrdenLinea => ({
  id: "l1", tipo: "articulo", articuloId: "M01-0001", descripcion: "Material",
  cantidad: 10, unidad: "UND", almacen: "ALM-GRAL", precioUnitario: 100, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0, ...o,
} as OrdenLinea);

const orden = (o: Partial<Orden> = {}): Orden => ({
  id: "1", numero: "CP-000001", proveedorId: "PROV-001", fecha: "2026-05-10",
  currencyCode: "", estado: "lanzado", lineas: [linea()], ...o,
} as Orden);

const HOY = "2026-09-22";
const TC = { factor: { USD: 450, EURO: 520.9 }, fecha: { USD: "2026-09-22", EURO: "2026-07-15" } };

test("kpis: las órdenes en otra moneda se suman convertidas, no se dejan afuera", () => {
  const k = kpisDeCompras([
    orden({ id: "1", lineas: [linea({ cantidad: 1, precioUnitario: 1000 })] }),                       // ₡1.000
    orden({ id: "2", currencyCode: "USD", lineas: [linea({ cantidad: 1, precioUnitario: 2 })] }),      // US$2 = ₡900
    orden({ id: "3", currencyCode: "EURO", lineas: [linea({ cantidad: 1, precioUnitario: 1 })] }),     // 1 € = ₡520,90
  ], HOY, TC);

  assert.equal(k.moneda, "CRC");
  assert.equal(Math.round(k.total.pedido), 2421);        // 1000 + 900 + 520,90
  assert.equal(k.total.ordenes, 3);
  assert.deepEqual(k.otrasMonedas, []);                  // nada quedó afuera
  assert.deepEqual(k.convertido.map((c) => [c.moneda, c.ordenes, c.factor, c.fecha]), [
    ["USD", 1, 450, "2026-09-22"],
    ["EURO", 1, 520.9, "2026-07-15"],
  ]);
});

test("kpis: sin tipo de cambio la orden queda fuera y se dice cuál (no se suma 1 a 1)", () => {
  const ordenes = [
    orden({ id: "1", lineas: [linea({ cantidad: 1, precioUnitario: 1000 })] }),
    orden({ id: "2", currencyCode: "USD", lineas: [linea({ cantidad: 1, precioUnitario: 2 })] }),
    orden({ id: "3", currencyCode: "USD", lineas: [linea({ cantidad: 1, precioUnitario: 5 })] }),
  ];
  // Sin tipo de cambio del todo (BC no contestó): se comporta como antes.
  const k = kpisDeCompras(ordenes, HOY);
  assert.equal(k.total.pedido, 1000);
  assert.deepEqual(k.otrasMonedas, [{ moneda: "USD", ordenes: 2 }]);
  assert.deepEqual(k.convertido, []);

  // Con el factor de otra moneda, tampoco se inventa el que falta.
  const k2 = kpisDeCompras(ordenes, HOY, { factor: { EURO: 520.9 } });
  assert.equal(k2.total.pedido, 1000);
  assert.deepEqual(k2.otrasMonedas, [{ moneda: "USD", ordenes: 2 }]);
});

test("kpis: lo recibido y el saldo vivo también van convertidos", () => {
  const k = kpisDeCompras([
    orden({
      id: "2", currencyCode: "USD",
      lineas: [linea({ cantidad: 10, precioUnitario: 1, cantidadRecibida: 4 })],   // US$10 pedidos, US$4 recibidos
    }),
  ], HOY, TC);
  assert.equal(k.total.pedido, 4500);
  assert.equal(k.total.recibido, 1800);
  assert.equal(k.vivo.pendiente, 2700);
  assert.equal(k.vivo.pct, 40);
  // Y la plata trabada por estado (la orden está lanzada) sale en colones.
  assert.equal(Math.round(k.enCurso), 4500);
});

test("kpis: el colón no necesita factor aunque BC no conteste", () => {
  const k = kpisDeCompras([
    orden({ id: "1", currencyCode: "" }),
    orden({ id: "2", currencyCode: "CRC" }),   // BC devuelve "CRC"; es la misma moneda
  ], HOY);
  assert.equal(k.total.ordenes, 2);
  assert.equal(k.total.pedido, 2000);
  assert.deepEqual(k.otrasMonedas, []);
});

// El par de BC: `exchangeRateAmount` unidades cuestan `relationalExchangeRateAmount`
// colones. Casi siempre es 1 : 450, pero una moneda puede cotizarse por 100 unidades
// y ahí dividir es la diferencia entre ₡450 y ₡4,50.
test("tipo de cambio: el par de BC se convierte a colones por unidad", () => {
  assert.equal(factorDeCambio(1, 450), 450);
  assert.equal(factorDeCambio(100, 45000), 450);
  assert.equal(factorDeCambio(1, 520.9), 520.9);
  // Basura adentro, nada afuera: mejor sin factor (la orden queda declarada) que un
  // factor inventado que multiplica todos los paneles.
  assert.equal(factorDeCambio(0, 450), null);
  assert.equal(factorDeCambio(1, 0), null);
  assert.equal(factorDeCambio(undefined, undefined), null);
  assert.equal(factorDeCambio(1, Number.NaN), null);
});
