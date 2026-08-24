// Pruebas de la unidad de COMPRA contra la unidad BASE. El caso real que las
// motivó: el adhesivo M06-0009 tiene base GR y se compra por ESTAÑON (1 EST =
// 255.000 GR); la app mostraba "1 GR" a ₡1,74 cuando el estañón vale ₡442.435.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { unidadDeCompra, unidadCorregida, equivalencia, equivalenciaDeUnidad, precioEnUnidad, precioEntreUnidades, cantidadEntreUnidades, codigoDeItem, opcionesDeUnidad, mismaMoneda } from "./unidad.ts";

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

// ---- Elegir la unidad con la que se compra -------------------------------
// Las unidades de M06-0009 tal como están en BC (captura del 24 ago 2026).
const unidadesAdhesivo = [
  { code: "GR", factor: 1 },
  { code: "EST", factor: 255000 },
  { code: "LT", factor: 244.01914 },
  { code: "CUB", factor: 4636.36364 },
  { code: "TANQUETA", factor: 1100000 },
];

test("precioEntreUnidades: del gramo al estañón", () => {
  assert.equal(precioEntreUnidades(1.735, 1, 255000), 442425);
});

test("precioEntreUnidades: entre dos alternas (lo que precioEnUnidad no sabe hacer)", () => {
  // Un estañón trae 255.000 GR y un litro 244,01914 GR: el precio por litro es
  // el del estañón dividido entre los estañones que caben en un litro.
  const porEst = 442425;
  const porLt = precioEntreUnidades(porEst, 255000, 244.01914);
  assert.ok(porLt !== null);
  assert.ok(Math.abs(porLt - 423.34) < 0.5);
});

test("precioEntreUnidades: ida y vuelta no pierde el precio", () => {
  const ida = precioEntreUnidades(442425, 255000, 1100000);
  assert.ok(ida !== null);
  const vuelta = precioEntreUnidades(ida, 1100000, 255000);
  assert.ok(vuelta !== null);
  assert.ok(Math.abs(vuelta - 442425) < 0.0001);
});

test("precioEntreUnidades: sin factor NO adivina", () => {
  assert.equal(precioEntreUnidades(100, 0, 255000), null);
  assert.equal(precioEntreUnidades(100, 255000, undefined), null);
  assert.equal(precioEntreUnidades(100, -1, 5), null);
});

test("precioEntreUnidades: la misma unidad pasa igual", () => {
  assert.equal(precioEntreUnidades(969.91, 255000, 255000), 969.91);
});

test("equivalenciaDeUnidad: explica la unidad elegida, no la de compra", () => {
  // Intl es-CR separa los miles con espacio fino, igual que el resto de la app.
  const fmt = (n: number) => new Intl.NumberFormat("es-CR", { maximumFractionDigits: 5 }).format(n);
  assert.equal(equivalenciaDeUnidad(unidadesAdhesivo, "EST", "GR"), `1 EST = ${fmt(255000)} GR`);
  assert.equal(equivalenciaDeUnidad(unidadesAdhesivo, "LT", "GR"), `1 LT = ${fmt(244.01914)} GR`);
});

test("equivalenciaDeUnidad: la base no necesita explicación", () => {
  assert.equal(equivalenciaDeUnidad(unidadesAdhesivo, "GR", "GR"), null);
});

test("equivalenciaDeUnidad: unidad desconocida o sin factor no inventa", () => {
  assert.equal(equivalenciaDeUnidad(unidadesAdhesivo, "HRS", "GR"), null);
  assert.equal(equivalenciaDeUnidad([], "EST", "GR"), null);
});

test("cantidadEntreUnidades: 255.000 gramos son 1 estañón", () => {
  assert.equal(cantidadEntreUnidades(255000, 1, 255000), 1);
  assert.equal(cantidadEntreUnidades(2, 255000, 1), 510000);
});

test("cantidadEntreUnidades: el valor de la línea no cambia al cambiar de unidad", () => {
  // 3 estañones a ₡442.425 tienen que valer lo mismo pasados a litros.
  const cant = cantidadEntreUnidades(3, 255000, 244.01914);
  const precio = precioEntreUnidades(442425, 255000, 244.01914);
  assert.ok(cant !== null && precio !== null);
  assert.ok(Math.abs(cant * precio - 3 * 442425) < 0.01);
});

test("cantidadEntreUnidades: sin factor NO adivina", () => {
  assert.equal(cantidadEntreUnidades(10, undefined, 255000), null);
});

test("cantidadEntreUnidades: con 8 decimales el importe de la línea casi no se mueve", () => {
  // 3 EST a ₡442.425 (₡1.327.275) pasados a TANQUETA y redondeados como lo hace la
  // pantalla: con 5 decimales la línea se movía ₡8,67, que en una orden grande se ve.
  const cant = cantidadEntreUnidades(3, 255000, 1100000);
  const precio = precioEntreUnidades(442425, 255000, 1100000);
  assert.ok(cant !== null && precio !== null);
  const importe = Number(cant.toFixed(8)) * Number(precio.toFixed(5));
  assert.ok(Math.abs(importe - 1327275) < 0.1, `se movió ${Math.abs(importe - 1327275)}`);
});

test("equivalenciaDeUnidad: sin base explícita la deduce de la lista (factor 1)", () => {
  const fmt = (n: number) => new Intl.NumberFormat("es-CR", { maximumFractionDigits: 5 }).format(n);
  assert.equal(equivalenciaDeUnidad(unidadesAdhesivo, "EST", ""), `1 EST = ${fmt(255000)} GR`);
});

test("equivalenciaDeUnidad: sin base y sin candidata no inventa", () => {
  assert.equal(equivalenciaDeUnidad([{ code: "EST", factor: 255000 }], "EST", ""), null);
});

// El caso real (24 ago 2026): en la pantalla de armar orden, las líneas con
// variante no mostraban el selector de unidad. El itemNo guardado traía la
// variante pegada y BC no reconocía ese código.
test("codigoDeItem: quita la variante pegada al código", () => {
  assert.equal(codigoDeItem("M11-0081 -VAR 12"), "M11-0081");
  assert.equal(codigoDeItem("M11-0073 -VAR 05"), "M11-0073");
});

test("codigoDeItem: un código limpio no se toca", () => {
  assert.equal(codigoDeItem("M06-0009"), "M06-0009");
  assert.equal(codigoDeItem("  M11-0019  "), "M11-0019");
});

test("codigoDeItem: vacío o ausente no revienta", () => {
  assert.equal(codigoDeItem(""), "");
  assert.equal(codigoDeItem(undefined as any), "");
});

test("opcionesDeUnidad: la unidad guardada que BC no tiene se ofrece igual", () => {
  // Solicitudes guardadas en UND para un material que en BC solo tiene CUB.
  const enBc = [{ code: "CUB", factor: 1 }, { code: "HRS", factor: 1 }];
  const r = opcionesDeUnidad(enBc, "UND");
  assert.equal(r.length, 3);
  assert.equal(r[0].code, "UND");
  assert.equal(r[0].factor, 0);      // sin factor: la conversión se niega sola
});

test("opcionesDeUnidad: si ya está en BC no se duplica", () => {
  const enBc = [{ code: "CUB", factor: 1 }, { code: "HRS", factor: 1 }];
  assert.equal(opcionesDeUnidad(enBc, "CUB").length, 2);
  assert.equal(opcionesDeUnidad(enBc, "cub").length, 2);   // sin importar mayúsculas
});

test("opcionesDeUnidad: sin unidad actual devuelve solo las de BC", () => {
  assert.equal(opcionesDeUnidad([{ code: "CUB", factor: 1 }], "").length, 1);
  assert.equal(opcionesDeUnidad(undefined, "UND").length, 1);
});
