// Pruebas de la unidad de COMPRA contra la unidad BASE. El caso real que las
// motivó: el adhesivo M06-0009 tiene base GR y se compra por ESTAÑON (1 EST =
// 255.000 GR); la app mostraba "1 GR" a ₡1,74 cuando el estañón vale ₡442.435.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { unidadDeCompra, unidadCorregida, equivalencia, precioEnUnidad, mismaMoneda } from "./unidad.ts";

const adhesivo = { base: "GR", compra: "EST", factor: 255000 };
const casco = { base: "UND", compra: "UND", factor: 1 };

test("unidadDeCompra: manda la de compra de BC", () => {
  assert.equal(unidadDeCompra(adhesivo, "GR"), "EST");
  assert.equal(unidadDeCompra(casco, "UND"), "UND");
});

test("unidadDeCompra: sin dato de BC respeta la unidad guardada, no inventa", () => {
  assert.equal(unidadDeCompra(undefined, "SACO"), "SACO");
  assert.equal(unidadDeCompra({ base: "", compra: "" }, "SACO"), "SACO");
  assert.equal(unidadDeCompra(undefined, ""), "");
});

test("unidadCorregida: la línea que heredó la base pasa a la unidad de compra", () => {
  assert.equal(unidadCorregida("GR", adhesivo), "EST");
  // También en minúscula o con espacios (viene de SQL).
  assert.equal(unidadCorregida(" gr ", adhesivo), "EST");
});

test("unidadCorregida: una unidad elegida a mano NO se reinterpreta", () => {
  // Alguien guardó KG a propósito: cambiarla sería cambiarle la cantidad al pedido.
  assert.equal(unidadCorregida("KG", adhesivo), "KG");
  assert.equal(unidadCorregida("EST", adhesivo), "EST");
});

test("unidadCorregida: sin dato de BC, o cuando base y compra coinciden, no toca nada", () => {
  assert.equal(unidadCorregida("GR", undefined), "GR");
  assert.equal(unidadCorregida("UND", casco), "UND");
});

test("equivalencia: explica cuánto trae la unidad de compra", () => {
  // Intl es-CR separa los miles con espacio fino, igual que el resto de la app.
  assert.equal(equivalencia(adhesivo), `1 EST = ${new Intl.NumberFormat("es-CR").format(255000)} GR`);
  assert.equal(equivalencia(casco), null);            // nada que aclarar
  assert.equal(equivalencia({ base: "GR", compra: "EST" }), null);  // sin factor, no se inventa
});

test("precioEnUnidad: el costo por gramo se convierte a precio por estañón", () => {
  const ref = { precio: 1.7350358823529413, unidad: "GR", moneda: "", factor: 255000 };
  const p = precioEnUnidad(ref, "EST", "GR");
  assert.ok(p !== null);
  // 1,7350358… × 255.000 = 442.434,15 — el importe real de la recepción CR-006577.
  assert.ok(Math.abs((p as number) - 442434.15) < 0.5, `dio ${p}`);
});

test("precioEnUnidad: el precio por estañón se convierte a costo por gramo", () => {
  const ref = { precio: 442434.15, unidad: "EST", moneda: "", factor: 255000 };
  const p = precioEnUnidad(ref, "GR", "GR");
  assert.ok(p !== null && Math.abs(p - 1.7350358) < 1e-6, `dio ${p}`);
});

test("precioEnUnidad: misma unidad pasa directo", () => {
  assert.equal(precioEnUnidad({ precio: 969.91, unidad: "EST", moneda: "USD" }, "EST", "GR"), 969.91);
});

test("precioEnUnidad: sin factor NO adivina — devuelve null", () => {
  assert.equal(precioEnUnidad({ precio: 1.735, unidad: "GR", moneda: "" }, "EST", "GR"), null);
});

test("precioEnUnidad: entre dos unidades alternas tampoco adivina", () => {
  // De TANQUETA a EST no hay conversión directa con un solo factor.
  assert.equal(precioEnUnidad({ precio: 100, unidad: "TANQUETA", moneda: "", factor: 1100000 }, "EST", "GR"), null);
});

test("precioEnUnidad: precio en cero o ausente no se usa", () => {
  assert.equal(precioEnUnidad({ precio: 0, unidad: "EST", moneda: "" }, "EST", "GR"), null);
  assert.equal(precioEnUnidad(null, "EST", "GR"), null);
});

test("mismaMoneda: colones viene en blanco en BC", () => {
  assert.equal(mismaMoneda("", "CRC"), true);
  assert.equal(mismaMoneda("CRC", ""), true);
  assert.equal(mismaMoneda("USD", ""), false);
  assert.equal(mismaMoneda("USD", "usd"), true);
});
