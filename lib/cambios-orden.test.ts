import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirCambiosDeLineas, type LineaCambio } from "./cambios-orden.ts";

const base = (o: Partial<LineaCambio>): LineaCambio => ({
  itemNo: "M10-0011", descripcion: "BASE GRANULAR", cantidad: 40, precioUnitario: 6991.15, ...o,
});

test("sin cambios en las líneas no inventa un movimiento", () => {
  const l = [base({})];
  assert.equal(resumirCambiosDeLineas(l, [base({})]), "");
});

test("la cantidad cambiada se dice con el antes y el después", () => {
  assert.equal(
    resumirCambiosDeLineas([base({ cantidad: 20 })], [base({ cantidad: 40 })]),
    "BASE GRANULAR M10-0011: cantidad 20 → 40",
  );
});

test("cantidad y precio en la misma línea salen juntos", () => {
  assert.equal(
    resumirCambiosDeLineas([base({ cantidad: 20, precioUnitario: 100 })], [base({ cantidad: 40, precioUnitario: 120 })]),
    "BASE GRANULAR M10-0011: cantidad 20 → 40 y precio 100 → 120",
  );
});

test("línea agregada y línea quitada se nombran como tales", () => {
  const antes = [base({})];
  const despues = [base({}), base({ itemNo: "M10-0099", descripcion: "ARENA", cantidad: 10 })];
  assert.equal(resumirCambiosDeLineas(antes, despues), "agregada ARENA M10-0099 ×10");
  assert.equal(resumirCambiosDeLineas(despues, antes), "quitada ARENA M10-0099 ×10");
});

test("la variante distingue dos líneas del mismo artículo", () => {
  const antes = [base({ variantCode: "G1" })];
  const despues = [base({ variantCode: "G2" })];
  const r = resumirCambiosDeLineas(antes, despues);
  assert.match(r, /quitada BASE GRANULAR M10-0011 \(G1\)/);
  assert.match(r, /agregada BASE GRANULAR M10-0011 \(G2\)/);
});

test("el mismo artículo repetido se empareja en orden y no inventa cambios", () => {
  const antes = [base({ cantidad: 10 }), base({ cantidad: 20 })];
  const despues = [base({ cantidad: 10 }), base({ cantidad: 25 })];
  assert.equal(resumirCambiosDeLineas(antes, despues), "BASE GRANULAR M10-0011: cantidad 20 → 25");
});

test("una línea sin código se identifica por su descripción", () => {
  const antes = [{ descripcion: "FLETE", cantidad: 1, precioUnitario: 5000 }];
  const despues = [{ descripcion: "FLETE", cantidad: 1, precioUnitario: 7500 }];
  assert.equal(resumirCambiosDeLineas(antes, despues), "FLETE: precio 5000 → 7500");
});

test("los decimales no se inventan ni se pierden", () => {
  assert.equal(
    resumirCambiosDeLineas([base({ precioUnitario: 6991.15 })], [base({ precioUnitario: 6991.2 })]),
    "BASE GRANULAR M10-0011: precio 6991.15 → 6991.2",
  );
  // 40 y 40.00 son la misma cantidad: no es un cambio.
  assert.equal(resumirCambiosDeLineas([base({ cantidad: 40 })], [base({ cantidad: 40.0 })]), "");
});

test("con muchos cambios se corta y se dice cuántos quedaron", () => {
  const antes = Array.from({ length: 10 }, (_, i) => base({ itemNo: `IT-${i}`, descripcion: `ART ${i}`, cantidad: 1 }));
  const despues = antes.map((l) => ({ ...l, cantidad: 2 }));
  const r = resumirCambiosDeLineas(antes, despues);
  assert.match(r, /y 4 cambio\(s\) más$/);
});
