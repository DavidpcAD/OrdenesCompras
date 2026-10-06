// EL FRENO DE PRECIO: lo que BC va a facturar tiene que ser lo que dice la orden.
//
// Lo que cuidan estas pruebas es el equilibrio del freno: que agarre la plata que se
// movió sin permiso (precio, IVA, unidad) y que NO frene por lo que no sabe. Un freno
// que salta de gusto es peor que no tenerlo: Bodega deja de poder recibir un camión y
// termina apagado desde Azure, que es como se pierden los frenos de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diferenciasAlPostear, tituloDeDiferencias } from "./freno-precio.ts";
import type { LineaApp, LineaBc } from "./bc-conciliacion.ts";

const app = (p: Partial<LineaApp> & { itemNo: string }): LineaApp => ({
  id: p.itemNo, tipo: "articulo", variantCode: "", descripcion: p.itemNo,
  cantidad: 1, precioUnitario: 0, unidad: "UND", ...p,
});
const bc = (p: Partial<LineaBc> & { itemNo: string }): LineaBc => ({
  documentNo: "CP-005652", lineNo: 10000, tipo: "articulo", variantCode: "",
  descripcion: p.itemNo, unidad: "UND", almacen: "ALM-GRAL",
  cantidad: 1, recibida: 0, facturada: 0, pendiente: 1, precioUnitario: 0, ...p,
});

test("si los dos lados dicen lo mismo, no hay nada que frenar", () => {
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M17-0029", cantidad: 6, precioUnitario: 550, ivaPct: 13 })],
    [bc({ itemNo: "M17-0029", cantidad: 6, precioUnitario: 550, ivaPct: 13 })],
    [{ itemNo: "M17-0029", qty: 6, tipo: "articulo" }],
  );
  assert.deepEqual(difs, []);
});

test("CP-005652: el 1% de la orden que BC calculó al 13% son ₡18.864 de más", () => {
  // El caso que destapó esto. El NETO coincidía al céntimo y la factura igual entró
  // ₡18.864,00 arriba: el papel higiénico va al 1% y la línea de BC estaba en 13%.
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M17-0300", descripcion: "PAPEL HIGIENICO TORK", cantidad: 72, precioUnitario: 2183.333, ivaPct: 1 })],
    [bc({ itemNo: "M17-0300", descripcion: "PAPEL HIGIENICO TORK", cantidad: 72, precioUnitario: 2183.333, ivaPct: 13 })],
    [{ itemNo: "M17-0300", qty: 72, tipo: "articulo" }],
  );
  assert.equal(difs.length, 1);
  assert.equal(difs[0].clase, "iva");
  assert.equal(difs[0].app, 1);
  assert.equal(difs[0].bc, 13);
  // Positivo = BC factura de MÁS. 72 × 2.183,333 × 12% = 18.863,997.
  assert.ok(difs[0].importe > 18_863 && difs[0].importe < 18_865, String(difs[0].importe));
  assert.match(difs[0].texto, /1% de IVA y en BC la línea calcula 13%/);
  assert.match(difs[0].texto, /de más/);
});

test("el precio cruzado de CP-005579 se ve antes de postear, no después", () => {
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M01-0070", cantidad: 15, precioUnitario: 13135.35, ivaPct: 13 })],
    [bc({ itemNo: "M01-0070", cantidad: 15, precioUnitario: 12348.60, ivaPct: 13 })],
    [{ itemNo: "M01-0070", qty: 15, tipo: "articulo" }],
  );
  assert.equal(difs.length, 1);
  assert.equal(difs[0].clase, "precio");
  // BC factura de MENOS: 15 × (12.348,60 − 13.135,35) = −11.801,25.
  assert.ok(Math.abs(difs[0].importe + 11_801.25) < 0.01, String(difs[0].importe));
  assert.match(difs[0].texto, /de menos/);
});

test("la plata se cuenta sobre lo que entra AHORA, no sobre la línea entera", () => {
  // 40 pedidas, 10 en esta factura: lo que está en juego hoy son 10 × la diferencia.
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M01-0096", cantidad: 40, precioUnitario: 100 })],
    [bc({ itemNo: "M01-0096", cantidad: 40, precioUnitario: 110 })],
    [{ itemNo: "M01-0096", qty: 10, tipo: "articulo" }],
  );
  assert.equal(difs[0].cantidad, 10);
  assert.ok(Math.abs(difs[0].importe - 100) < 1e-9, String(difs[0].importe));
});

test("una línea que NO entra en esta factura no para el camión", () => {
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M17-0029", cantidad: 6, precioUnitario: 550 }),
     app({ itemNo: "M17-0035", cantidad: 78, precioUnitario: 465 })],
    [bc({ itemNo: "M17-0029", cantidad: 6, precioUnitario: 550 }),
     bc({ itemNo: "M17-0035", cantidad: 78, precioUnitario: 999 })],   // ésta está mal…
    [{ itemNo: "M17-0029", qty: 6, tipo: "articulo" }],                 // …y no se registra
  );
  assert.deepEqual(difs, []);
});

test("la unidad va primero: con otra unidad el precio no se compara", () => {
  // 1 EST son 255.000 GR: el mismo número queriendo decir otra cosa. Sale UNA sola
  // diferencia (la de unidad) y no además una de precio, que sería ruido.
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M07-0001", cantidad: 1, precioUnitario: 255000, unidad: "EST" })],
    [bc({ itemNo: "M07-0001", cantidad: 1, precioUnitario: 1, unidad: "GR" })],
    [{ itemNo: "M07-0001", qty: 1, tipo: "articulo" }],
  );
  assert.equal(difs.length, 1);
  assert.equal(difs[0].clase, "unidad");
  assert.match(difs[0].texto, /compra en EST y en BC la línea quedó en GR/);
});

test("lo que BC no dice no se acusa: sin IVA leído no hay diferencia de IVA", () => {
  // El codeunit y la API estándar no siempre devuelven el %. "No lo sé" nunca frena.
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M17-0300", cantidad: 72, precioUnitario: 2183.333, ivaPct: 1 })],
    [bc({ itemNo: "M17-0300", cantidad: 72, precioUnitario: 2183.333 })],
    [{ itemNo: "M17-0300", qty: 72, tipo: "articulo" }],
  );
  assert.deepEqual(difs, []);
});

test("el mismo artículo con dos IVA en la orden es ambiguo: se deja pasar", () => {
  // Los dos lados se casan por CÓDIGO; con el mismo artículo a dos IVA distintos no
  // hay forma de saber cuál línea de BC es cuál, y frenar sería adivinar.
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M17-0300", cantidad: 36, precioUnitario: 100, ivaPct: 1 }),
     app({ itemNo: "M17-0300", cantidad: 36, precioUnitario: 100, ivaPct: 13 })],
    [bc({ itemNo: "M17-0300", cantidad: 72, precioUnitario: 100, ivaPct: 13 })],
    [{ itemNo: "M17-0300", qty: 72, tipo: "articulo" }],
  );
  assert.deepEqual(difs, []);
});

test("una línea que BC no tiene es asunto del otro freno, no de éste", () => {
  // De eso habla `verificarLineasPosteables`, que además sabe el saldo. Decirlo dos
  // veces, con dos textos distintos, es la forma más rápida de que nadie lea ninguno.
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M06-0116", cantidad: 7000, precioUnitario: 3.26 })],
    [],
    [{ itemNo: "M06-0116", qty: 7000, tipo: "articulo" }],
  );
  assert.deepEqual(difs, []);
});

test("el mismo material repetido se compara por el precio promedio", () => {
  // Una orden puede llevar el mismo artículo en dos líneas (otro almacén, otra obra)
  // y BC las guarda separadas. Lo que importa es que la plata por unidad coincida.
  const iguales = diferenciasAlPostear(
    [app({ itemNo: "M01-0070", cantidad: 10, precioUnitario: 100 }),
     app({ itemNo: "M01-0070", cantidad: 10, precioUnitario: 200 })],
    [bc({ itemNo: "M01-0070", cantidad: 20, precioUnitario: 150 })],
    [{ itemNo: "M01-0070", qty: 20, tipo: "articulo" }],
  );
  assert.deepEqual(iguales, []);
});

test("medio céntimo no es una diferencia; dos sí", () => {
  const nada = diferenciasAlPostear(
    [app({ itemNo: "X", cantidad: 1, precioUnitario: 100.004 })],
    [bc({ itemNo: "X", cantidad: 1, precioUnitario: 100 })],
    [{ itemNo: "X", qty: 1, tipo: "articulo" }],
  );
  assert.deepEqual(nada, []);
  const algo = diferenciasAlPostear(
    [app({ itemNo: "X", cantidad: 1, precioUnitario: 100.02 })],
    [bc({ itemNo: "X", cantidad: 1, precioUnitario: 100 })],
    [{ itemNo: "X", qty: 1, tipo: "articulo" }],
  );
  assert.equal(algo.length, 1);
});

test("el CARGO no se compara: BC le reescribe cantidad y precio al repartirlo", () => {
  const difs = diferenciasAlPostear(
    [{ ...app({ itemNo: "FLETE", cantidad: 1, precioUnitario: 25000 }), tipo: "cargo" }],
    [{ ...bc({ itemNo: "FLETE", cantidad: 7, precioUnitario: 3571.42 }), tipo: "cargo" }],
    [{ itemNo: "FLETE", qty: 1, tipo: "cargo" }],
  );
  assert.deepEqual(difs, []);
});

test("un recurso se compara igual que un artículo", () => {
  const difs = diferenciasAlPostear(
    [{ ...app({ itemNo: "MO-001", cantidad: 8, precioUnitario: 5000 }), tipo: "recurso" }],
    [{ ...bc({ itemNo: "MO-001", cantidad: 8, precioUnitario: 7000 }), tipo: "recurso" }],
    [{ itemNo: "MO-001", qty: 8, tipo: "recurso" }],
  );
  assert.equal(difs.length, 1);
  assert.equal(difs[0].clase, "precio");
});

test("precio e IVA de la misma línea son dos diferencias, no una", () => {
  const difs = diferenciasAlPostear(
    [app({ itemNo: "M17-0300", cantidad: 10, precioUnitario: 100, ivaPct: 1 })],
    [bc({ itemNo: "M17-0300", cantidad: 10, precioUnitario: 120, ivaPct: 13 })],
    [{ itemNo: "M17-0300", qty: 10, tipo: "articulo" }],
  );
  assert.deepEqual(difs.map((d) => d.clase).sort(), ["iva", "precio"]);
  // La más cara va primero: 10 × 20 = 200 contra 10 × 120 × 12% = 144.
  assert.equal(difs[0].clase, "precio");
});

test("el título dice de qué se trata: el IVA solo no se anuncia como precio", () => {
  assert.match(tituloDeDiferencias([{ clase: "iva" } as any]), /IVA/);
  assert.match(tituloDeDiferencias([{ clase: "precio" } as any]), /precio/);
  assert.match(tituloDeDiferencias([{ clase: "unidad" } as any]), /unidad/);
  assert.match(tituloDeDiferencias([{ clase: "iva" } as any, { clase: "precio" } as any]), /va a facturar/);
});
