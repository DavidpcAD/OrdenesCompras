// De quién es una factura de BC, y cuál es el comprobante de una factura que se digita.
//
// Cada prueba reproduce un caso que salió en la Auditoría y en Registrar factura
// (nov 2026). Los datos son de PRUEBA a propósito —el repo es público—: lo que importa
// es la forma del caso, no de quién era.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { comprobanteDeNumero, facturasAnuladas, facturasParaCotejo, numeroDigitadoEs, sinPuntoFinal, type ComprobanteBuscable } from "./enlace-factura.ts";
import { cruzar, type Comprobante } from "./cruce-correo-bc.ts";

test("el N.º digitado en BC es el de ese comprobante, no el de otro del mismo proveedor", () => {
  assert.equal(numeroDigitadoEs("00100001010000123401", "123401"), true);
  assert.equal(numeroDigitadoEs("00100001010000123499", "123401"), false);
});

test("un N.º que es un pedazo de la clave corrido un dígito no es de ninguno de los dos", () => {
  // Se tecleó mirando la clave de 50 dígitos y no el consecutivo: por eso el cotejo
  // automático no la amarró y por eso decide la persona.
  assert.equal(numeroDigitadoEs("00100001010000555111", "552221"), false);
  assert.equal(numeroDigitadoEs("00100001010000555222", "552221"), false);
});

test("una factura grande digitada con el N.º de un comprobante chiquito calza con el chiquito", () => {
  // Es justo lo que confundía al cotejo: le creía al número y no al monto.
  assert.equal(numeroDigitadoEs("00200009010000777001", "777001"), true);
  assert.equal(numeroDigitadoEs("00200006010000888002", "777001"), false);
});

test("un N.º vacío o sin dígitos no calza con nada", () => {
  assert.equal(numeroDigitadoEs("00100001010000123401", ""), false);
  assert.equal(numeroDigitadoEs("00100001010000123401", null), false);
  assert.equal(numeroDigitadoEs("00100001010000123401", "S/N"), false);
});

test("el nombre del emisor no deja el punto doble en el aviso", () => {
  assert.equal(sinPuntoFinal("PROVEEDOR DE PRUEBA S. A."), "PROVEEDOR DE PRUEBA S. A");
  assert.equal(`de ${sinPuntoFinal("PROVEEDOR DE PRUEBA S. A.")}.`, "de PROVEEDOR DE PRUEBA S. A.");
  assert.equal(sinPuntoFinal("PROVEEDOR DE PRUEBA SOCIEDAD ANONIMA"), "PROVEEDOR DE PRUEBA SOCIEDAD ANONIMA");
  assert.equal(sinPuntoFinal(null), "");
});

// ---------------------------------------------------------------------------
// Registrar factura: encontrar en el correo el comprobante del N.º que se digita.

// Una clave de Hacienda armada a mano: 506 + fecha + cédula (12) + consecutivo (20) +
// situación + código de seguridad = 50 dígitos.
const clave = (cedula: string, consecutivo: string) =>
  `506011126${cedula.padStart(12, "0")}${consecutivo}100000000`;

const c = (consecutivo: string, tipoDoc: string, cedulaEmisor: string, nombreEmisor: string): ComprobanteBuscable =>
  ({ clave: clave(cedulaEmisor, consecutivo), consecutivo, tipoDoc, cedulaEmisor, nombreEmisor });

const DEL_PROVEEDOR = c("00100001010000123456", "01", "3101000000", "Proveedor de Prueba, S.A.");
// Otro emisor con la misma cola: sin amarrar al proveedor, esto calzaría.
const DE_OTRO = c("00100001010000123456", "01", "3101111111", "Otro Emisor de Ejemplo S.A.");
// Una nota de crédito del mismo proveedor con la misma cola: NO es una factura.
const NOTA = c("00100001030000123456", "03", "3101000000", "Proveedor de Prueba, S.A.");
const FILAS = [DEL_PROVEEDOR, DE_OTRO, NOTA];
const PROVEEDOR = { nombre: "PROVEEDOR DE PRUEBA, S.A." };

test("la cola que se teclea encuentra el comprobante del proveedor de la orden", () => {
  assert.equal(comprobanteDeNumero(FILAS, "123456", PROVEEDOR), DEL_PROVEEDOR);
});

test("con letras o ceros adelante también", () => {
  assert.equal(comprobanteDeNumero(FILAS, "F-0123456", PROVEEDOR), DEL_PROVEEDOR);
});

test("con el consecutivo de 20 o la clave de 50 también", () => {
  assert.equal(comprobanteDeNumero(FILAS, "00100001010000123456", PROVEEDOR), DEL_PROVEEDOR);
  assert.equal(comprobanteDeNumero(FILAS, DEL_PROVEEDOR.clave, PROVEEDOR), DEL_PROVEEDOR);
});

test("por cédula, aunque el nombre de la ficha de BC no se parezca", () => {
  assert.equal(comprobanteDeNumero(FILAS, "123456", { nombre: "NOMBRE DISTINTO EN BC", cedula: "3-101-000000" }), DEL_PROVEEDOR);
});

test("de otro proveedor no lo trae, aunque la cola sea idéntica", () => {
  assert.equal(comprobanteDeNumero(FILAS, "123456", { nombre: "NINGUNO CONOCIDO" }), null);
});

test("sin proveedor no busca: una cola sola calza con cualquier cosa", () => {
  assert.equal(comprobanteDeNumero(FILAS, "123456", {}), null);
});

test("un número muy corto no busca", () => {
  assert.equal(comprobanteDeNumero(FILAS, "456", PROVEEDOR), null);
});

test("si dos comprobantes del mismo proveedor calzan, no adivina", () => {
  const GEMELO = c("00100009010000123456", "01", "3101000000", "Proveedor de Prueba, S.A.");
  assert.equal(comprobanteDeNumero([...FILAS, GEMELO], "123456", PROVEEDOR), null);
  // Con el consecutivo completo sí se sabe cuál es.
  assert.equal(comprobanteDeNumero([...FILAS, GEMELO], "00100009010000123456", PROVEEDOR), GEMELO);
});

// ---------------------------------------------------------------------------
// Facturas anuladas en BC.

const FACTURAS_BC = [
  { numero: "CFR-000001", total: 1000 },
  { numero: "CFR-000002", total: 500 },
  { numero: "CFR-000003", total: 250 },   // sin nota de crédito
];
const nota = (numero: string, numeroProveedor: string, total: number, aplicaA: string) =>
  ({ numero, numeroProveedor, fecha: "2026-11-02", total, aplicaA });

test("una nota de crédito interna por el total anula la factura", () => {
  const a = facturasAnuladas(FACTURAS_BC, [nota("CNCR-000001", "NCI-000001", 1000, "CFR-000001")]);
  assert.deepEqual([...a.keys()], ["CFR-000001"]);
  assert.equal(a.get("CFR-000001")![0].numeroProveedor, "NCI-000001");
});

test("la nota de crédito del proveedor también anula", () => {
  const a = facturasAnuladas(FACTURAS_BC, [nota("CNCR-000002", "NC-000002", 500, "CFR-000002")]);
  assert.ok(a.has("CFR-000002"));
});

test("una nota parcial NO anula: la factura sigue siendo el registro", () => {
  const a = facturasAnuladas(FACTURAS_BC, [nota("CNC-000003", "NC-000003", 100, "CFR-000001")]);
  assert.equal(a.size, 0);
});

test("dos notas parciales que suman el total sí la anulan, y el redondeo no estorba", () => {
  const a = facturasAnuladas(FACTURAS_BC, [
    nota("CNCR-1", "NC-1", 100, "CFR-000001"),
    nota("CNCR-2", "NC-2", 899.99, "CFR-000001"),
  ]);
  assert.ok(a.has("CFR-000001"));
});

test("una nota sin factura aplicada no anula nada", () => {
  assert.equal(facturasAnuladas(FACTURAS_BC, [nota("CNCR-000004", "NC-000004", 250, "")]).size, 0);
});

// ---------------------------------------------------------------------------
// Qué puede tomar el cotejo automático.

const COMPROBANTE: Comprobante = {
  clave: clave("3101000000", "00100001010000000777"), consecutivo: "00100001010000000777", tipo: "01",
  cedulaEmisor: "3101000000", nombreEmisor: "Proveedor de Prueba, S.A.", cedulaReceptor: "",
  fecha: "2026-11-02", total: 100, moneda: "USD",
};
const PROVEEDORES = [{ codigo: "PROV-000001", nombre: "PROVEEDOR DE PRUEBA, S.A.", cedula: "3101000000" }];
const bc = (numero: string, numeroProveedor = "777", total = 100) => ({
  numero, numeroProveedor, proveedorCodigo: "PROV-000001", proveedorNombre: "PROVEEDOR DE PRUEBA, S.A.",
  fecha: "2026-11-02", total, moneda: "USD",
});
const cotejar = (facturas: ReturnType<typeof bc>[], retenidas = new Set<string>(), anuladas = new Map<string, unknown>()) =>
  cruzar([COMPROBANTE], facturasParaCotejo(facturas, retenidas, anuladas), PROVEEDORES);

test("un borrador de BC no es el registro: el comprobante sigue pendiente", () => {
  // Antes salía "Registrada" contra el borrador, y al registrarse de verdad BC lo
  // borraba y la fila quedaba amarrada a un N.º que ya no existía.
  const r = cotejar([bc("CF-000001", "777", 0)]);
  assert.equal(r.calzadas.length + r.descuadradas.length, 0);
  assert.deepEqual(r.soloEnCorreo.map((c) => c.clave), [COMPROBANTE.clave]);
});

test("ya registrada, calza con su CFR- aunque el borrador siga en la lista", () => {
  const r = cotejar([bc("CF-000001", "777", 0), bc("CFR-000001")]);
  assert.equal(r.calzadas[0]?.factura.numero, "CFR-000001");
});

test("la que ya tiene dueño o está anulada tampoco se ofrece", () => {
  assert.equal(cotejar([bc("CFR-000001")], new Set(["CFR-000001"])).soloEnCorreo.length, 1);
  assert.equal(cotejar([bc("CFR-000001")], new Set(), new Map([["CFR-000001", []]])).soloEnCorreo.length, 1);
});
