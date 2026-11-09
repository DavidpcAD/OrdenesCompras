// De quién es una factura de BC, y cuál es el comprobante de una factura que se digita.
//
// Los casos son los REALES del 9 nov 2026 (Kattya): Toyman, Tecni Gypsum, Construplaza
// en la Auditoría, y la 731655 de Durman en Registrar factura. Los N.º de BC salen de
// Business Central Production tal cual.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { comprobanteDeNumero, facturasAnuladas, numeroDigitadoEs, sinPuntoFinal, type ComprobanteBuscable } from "./enlace-factura.ts";

test("Toyman: CFR-011784 se digitó con el N.º de la 102944, no con el de la 103229", () => {
  assert.equal(numeroDigitadoEs("00100001010000102944", "102944"), true);
  assert.equal(numeroDigitadoEs("00100001010000103229", "102944"), false);
});

test("Tecni Gypsum: el '704181' de CFR-012135 no es el N.º de ninguno de los dos", () => {
  // Es un pedazo de la clave de la 370418 (…0370418134…), corrido un dígito: por eso
  // el cotejo automático no la amarró y por eso acá decide la persona.
  assert.equal(numeroDigitadoEs("00100001010000370159", "704181"), false);
  assert.equal(numeroDigitadoEs("00100001010000370418", "704181"), false);
});

test("Construplaza: CFR-012042 se digitó con el N.º 179529 aunque la factura es la 309100", () => {
  assert.equal(numeroDigitadoEs("00200009010000179529", "179529"), true);
  assert.equal(numeroDigitadoEs("00200006010000309100", "179529"), false);
});

test("un N.º vacío o sin dígitos no calza con nada", () => {
  assert.equal(numeroDigitadoEs("00100001010000102944", ""), false);
  assert.equal(numeroDigitadoEs("00100001010000102944", null), false);
  assert.equal(numeroDigitadoEs("00100001010000102944", "S/N"), false);
});

test("el nombre del emisor no deja el punto doble en el aviso", () => {
  assert.equal(sinPuntoFinal("TORNILLOS TOYMAN S. A."), "TORNILLOS TOYMAN S. A");
  assert.equal(`de ${sinPuntoFinal("TORNILLOS TOYMAN S. A.")}.`, "de TORNILLOS TOYMAN S. A.");
  assert.equal(sinPuntoFinal("TECNI GYPSUM SOCIEDAD ANONIMA"), "TECNI GYPSUM SOCIEDAD ANONIMA");
  assert.equal(sinPuntoFinal(null), "");
});

// ---------------------------------------------------------------------------
// Registrar factura: la 731655 de Durman llegó al correo emitida el 04/11/2026.

const c = (clave: string, consecutivo: string, tipoDoc: string, cedulaEmisor: string, nombreEmisor: string): ComprobanteBuscable =>
  ({ clave, consecutivo, tipoDoc, cedulaEmisor, nombreEmisor });

const DURMAN = c("50604112600310100677900100001010000731655110731655", "00100001010000731655", "01",
  "3101006779", "Durman Esquivel, S.A.");
// Otro proveedor con la misma cola: sin amarrar al proveedor, esto calzaría.
const OTRO = c("50604112600310112345600100001010000731655100000001", "00100001010000731655", "01",
  "3101123456", "Ferretería El Pochote S.A.");
// La nota de crédito de Durman con la misma cola: NO es una factura.
const NC = c("50605112600310100677900100001030000731655110000002", "00100001030000731655", "03",
  "3101006779", "Durman Esquivel, S.A.");
const FILAS = [DURMAN, OTRO, NC];

test("la cola que se teclea encuentra el comprobante del proveedor de la orden", () => {
  assert.equal(comprobanteDeNumero(FILAS, "731655", { nombre: "DURMAN ESQUIVEL, S.A." }), DURMAN);
});

test("con letras o ceros adelante también", () => {
  assert.equal(comprobanteDeNumero(FILAS, "F-0731655", { nombre: "DURMAN ESQUIVEL, S.A." }), DURMAN);
});

test("con el consecutivo de 20 o la clave de 50 también", () => {
  assert.equal(comprobanteDeNumero(FILAS, "00100001010000731655", { nombre: "DURMAN ESQUIVEL, S.A." }), DURMAN);
  assert.equal(comprobanteDeNumero(FILAS, DURMAN.clave, { nombre: "DURMAN ESQUIVEL, S.A." }), DURMAN);
});

test("por cédula, aunque el nombre de BC no se parezca", () => {
  assert.equal(comprobanteDeNumero(FILAS, "731655", { nombre: "DESARROLLOS PVC", cedula: "3-101-006779" }), DURMAN);
});

test("de otro proveedor no lo trae, aunque la cola sea idéntica", () => {
  assert.equal(comprobanteDeNumero(FILAS, "731655", { nombre: "HOLCIM S.A." }), null);
});

test("sin proveedor no busca: una cola sola calza con cualquier cosa", () => {
  assert.equal(comprobanteDeNumero(FILAS, "731655", {}), null);
});

test("un número muy corto no busca", () => {
  assert.equal(comprobanteDeNumero(FILAS, "655", { nombre: "DURMAN ESQUIVEL, S.A." }), null);
});

test("si dos comprobantes del mismo proveedor calzan, no adivina", () => {
  const GEMELA = c("50610112600310100677900100009010000731655110000003", "00100009010000731655", "01",
    "3101006779", "Durman Esquivel, S.A.");
  assert.equal(comprobanteDeNumero([...FILAS, GEMELA], "731655", { nombre: "DURMAN ESQUIVEL, S.A." }), null);
  // Con el consecutivo completo sí se sabe cuál es.
  assert.equal(comprobanteDeNumero([...FILAS, GEMELA], "00100009010000731655", { nombre: "DURMAN ESQUIVEL, S.A." }), GEMELA);
});

// ---------------------------------------------------------------------------
// Facturas anuladas en BC. Las cifras son las de Production el 9 nov 2026.

const FACTURAS_BC = [
  { numero: "CFR-012042", total: 421376.01 },   // Construplaza, digitada con el N.º 179529
  { numero: "CFR-012135", total: 75937.13 },    // Tecni Gypsum
  { numero: "CFR-011784", total: 11876.3 },     // Toyman, sin nota de crédito
];
const nota = (numero: string, numeroProveedor: string, total: number, aplicaA: string) =>
  ({ numero, numeroProveedor, fecha: "2026-11-02", total, aplicaA });

test("una nota de crédito por el total anula la factura (Construplaza, NCI-179529)", () => {
  const a = facturasAnuladas(FACTURAS_BC, [nota("CNCR-000514", "NCI-179529", 421376.01, "CFR-012042")]);
  assert.deepEqual([...a.keys()], ["CFR-012042"]);
  assert.equal(a.get("CFR-012042")![0].numeroProveedor, "NCI-179529");
});

test("la del proveedor también anula (Tecni Gypsum, NC-224254)", () => {
  const a = facturasAnuladas(FACTURAS_BC, [nota("CNCR-000513", "NC-224254", 75937.13, "CFR-012135")]);
  assert.ok(a.has("CFR-012135"));
});

test("una nota parcial NO anula: la factura sigue siendo el registro (NC-290285 por ₡6 912)", () => {
  const a = facturasAnuladas(FACTURAS_BC, [nota("CNC-000568", "NC-290285", 6912, "CFR-012042")]);
  assert.equal(a.size, 0);
});

test("dos notas parciales que suman el total sí la anulan, y el redondeo no estorba", () => {
  const a = facturasAnuladas(FACTURAS_BC, [
    nota("CNCR-1", "NC-1", 6912, "CFR-012042"),
    nota("CNCR-2", "NC-2", 414464, "CFR-012042"),
  ]);
  assert.ok(a.has("CFR-012042"));
});

test("una nota sin factura aplicada no anula nada", () => {
  assert.equal(facturasAnuladas(FACTURAS_BC, [nota("CNCR-000483", "NC-288937", 374400.01, "")]).size, 0);
});
