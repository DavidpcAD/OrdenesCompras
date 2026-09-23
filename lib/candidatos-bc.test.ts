// Los candidatos cuando el número quedó mal tecleado.
//
// Todos los casos de acá son REALES: salen del Excel donde Contabilidad venía
// apuntando a mano "REGISTRADA CON EL # …", cruzado contra las facturas que BC tenía
// del 20 de agosto al 20 de setiembre de 2026. Por eso se puede afirmar cuál es la
// respuesta correcta de cada uno: alguien ya la había encontrado a pulso.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatosDeFactura, parecidoDeNumero, cotejarRenglones, type ComprobanteBuscado } from "./candidatos-bc.ts";
import type { FacturaBc, ProveedorBc } from "./vigilancia-facturas.ts";

const f = (
  numero: string, numeroProveedor: string, proveedorCodigo: string, proveedorNombre: string,
  fecha: string, total: number, moneda = "CRC",
): FacturaBc => ({ numero, numeroProveedor, proveedorCodigo, proveedorNombre, fecha, total, moneda });

// Las facturas tal cual están en Business Central.
const BC = {
  holcimA: f("CFR-009996", "319869", "PROV-000694", "HOLCIM S.A.", "2026-09-01", 3251169.74),
  holcimB: f("CFR-010310", "20604", "PROV-000694", "HOLCIM S.A.", "2026-09-07", 3239832.84),
  ditesa: f("CFR-009906", "9749", "PROV-000400", "DISTRIBUIDORA TECNICA, S.A. (DITESA)", "2026-09-02", 13721.7),
  brenes: f("CFR-009966", "5891", "PROV-000740", "INDUSTRIAS BRENES S.A.", "2026-09-04", 8441.1),
  brenesGemela: f("CFR-010270", "0721", "PROV-000740", "INDUSTRIAS BRENES S.A.", "2026-09-16", 8441.1),
  expo: f("CFR-010346", "46309", "PROV-000495", "EXPOCERAMICA  ACABADOS S.A", "2026-09-14", 529198.55),
  multi: f("CFR-009873", "91239", "PROV-001717", "Multisuministros de Costa Rica CR S.A.", "2026-09-03", 25990),
};
const TODAS = Object.values(BC);

const PROVEEDORES: ProveedorBc[] = [
  { codigo: "PROV-000694", nombre: "HOLCIM S.A.", cedula: "3101021049" },
  { codigo: "PROV-000400", nombre: "DISTRIBUIDORA TECNICA, S.A. (DITESA)", cedula: "3101023297" },
  { codigo: "PROV-000740", nombre: "INDUSTRIAS BRENES S.A.", cedula: "3101037215" },
  { codigo: "PROV-000495", nombre: "EXPOCERAMICA  ACABADOS S.A", cedula: "3101094293" },
  { codigo: "PROV-001717", nombre: "Multisuministros de Costa Rica CR S.A.", cedula: "3101812345" },
];

const comp = (o: Partial<ComprobanteBuscado>): ComprobanteBuscado => ({
  consecutivo: "", cedulaEmisor: "", nombreEmisor: "", fecha: "2026-09-01", total: 0, moneda: "CRC", ...o,
});

// --- los casos que Contabilidad ya había resuelto a mano --------------------

test("HOLCIM: el consecutivo termina en 319868 y en BC quedó 319869", () => {
  const c = candidatosDeFactura(comp({
    consecutivo: "00100001010000319868", cedulaEmisor: "3101021049",
    nombreEmisor: "HOLCIM (COSTA RICA) S.A.", fecha: "2026-09-01", total: 3251168.86,
  }), TODAS, PROVEEDORES);
  assert.equal(c[0].factura.numero, "CFR-009996");
  // La diferencia de ₡0,88 es redondeo entre el XML y BC, y se nombra.
  assert.equal(c[0].difMonto, 0.88);
  assert.ok(c[0].razones.some((r) => r.includes("un dígito de diferencia")), c[0].razones.join(" · "));
});

test("DITESA: el digitador tecleó 9749 de un consecutivo que termina en 129749", () => {
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000129749", cedulaEmisor: "3101023297",
    nombreEmisor: "Distribuidora Técnica SA", fecha: "2026-09-02", total: 13721.70,
  }), TODAS, PROVEEDORES);
  assert.equal(c[0].factura.numero, "CFR-009906");
  assert.ok(c[0].razones.includes("el monto es idéntico"));
  assert.ok(c[0].razones.some((r) => r.includes("termina en 9749")));
});

test("EXPOCERÁMICA: el número no se parece en NADA y aun así aparece", () => {
  // 00700001010000040045 contra "46309". Acá lo único que hay es proveedor, monto y
  // día — que es justo el caso que el cruce por número no puede resolver nunca.
  const c = candidatosDeFactura(comp({
    consecutivo: "00700001010000040045", cedulaEmisor: "3101094293",
    nombreEmisor: "EXPOCERAMICA ACABADOS SOCIEDAD ANONIMA", fecha: "2026-09-14", total: 529198.55,
  }), TODAS, PROVEEDORES);
  assert.equal(c[0].factura.numero, "CFR-010346");
  assert.equal(c[0].difMonto, 0);
});

test("MULTISUMINISTROS: un solo dedazo, 81239 contra 91239", () => {
  const c = candidatosDeFactura(comp({
    consecutivo: "00100001010000081239", cedulaEmisor: "3101812345",
    nombreEmisor: "MULTISUMINISTROS DE COSTA RICA CR S.A.", fecha: "2026-09-01", total: 25990,
  }), TODAS, PROVEEDORES);
  assert.equal(c[0].factura.numero, "CFR-009873");
});

// --- lo que NO debe hacer --------------------------------------------------

test("dos facturas idénticas del mismo proveedor: gana la del día, pero las dos se muestran", () => {
  // El caso de los discos de sierra: ₡8.441,10 el 4 de setiembre y otra vez el 16,
  // con los MISMOS renglones. Ninguna regla puede separarlas sola; lo que se puede
  // hacer es poner primero la del día y enseñar las dos.
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000000589", cedulaEmisor: "3101037215",
    nombreEmisor: "Industrias Brenes S.A", fecha: "2026-09-04", total: 8441.10,
  }), TODAS, PROVEEDORES);
  assert.equal(c[0].factura.numero, "CFR-009966");
  assert.ok(c.some((x) => x.factura.numero === "CFR-010270"), "la gemela tiene que seguir visible");
});

test("nunca propone la factura de OTRO proveedor, aunque el monto sea igual", () => {
  const otro = f("CFR-099999", "5891", "PROV-000694", "HOLCIM S.A.", "2026-09-04", 8441.1);
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000000589", cedulaEmisor: "3101037215",
    nombreEmisor: "Industrias Brenes S.A", fecha: "2026-09-04", total: 8441.10,
  }), [...TODAS, otro], PROVEEDORES);
  assert.ok(!c.some((x) => x.factura.numero === "CFR-099999"));
});

test("una factura ya enlazada a otro comprobante no se vuelve a ofrecer", () => {
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000129749", cedulaEmisor: "3101023297",
    nombreEmisor: "Distribuidora Técnica SA", fecha: "2026-09-02", total: 13721.70,
  }), TODAS, PROVEEDORES, { yaEnlazadas: new Set(["CFR-009906"]) });
  assert.ok(!c.some((x) => x.factura.numero === "CFR-009906"));
});

test("monedas distintas no se mezclan", () => {
  const enDolares = f("CFR-088888", "9749", "PROV-000400", "DISTRIBUIDORA TECNICA, S.A. (DITESA)", "2026-09-02", 13721.7, "USD");
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000129749", cedulaEmisor: "3101023297",
    nombreEmisor: "Distribuidora Técnica SA", fecha: "2026-09-02", total: 13721.70, moneda: "CRC",
  }), [enDolares], PROVEEDORES);
  assert.equal(c.length, 0);
});

test("monto lejano y número que no se parece: no es candidato", () => {
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000999999", cedulaEmisor: "3101037215",
    nombreEmisor: "Industrias Brenes S.A", fecha: "2026-09-04", total: 500000,
  }), TODAS, PROVEEDORES);
  assert.equal(c.length, 0);
});

test("fuera de la ventana de días no aparece", () => {
  const c = candidatosDeFactura(comp({
    consecutivo: "00100002010000000589", cedulaEmisor: "3101037215",
    nombreEmisor: "Industrias Brenes S.A", fecha: "2026-06-01", total: 8441.10,
  }), TODAS, PROVEEDORES);
  assert.equal(c.length, 0);
});

// --- el parecido de números ------------------------------------------------

test("reconoce las cuatro formas de teclear mal un número", () => {
  assert.ok(parecidoDeNumero("00100002010000129749", "9749"));       // menos dígitos
  assert.ok(parecidoDeNumero("00100002010000129841", "70129841"));   // con prefijo propio
  assert.ok(parecidoDeNumero("00100002010000000567", "5671"));       // con algo pegado atrás
  assert.ok(parecidoDeNumero("00100001010000081239", "91239"));      // un dedazo
});

test("no ve parecido donde no lo hay", () => {
  assert.equal(parecidoDeNumero("00700001010000040045", "46309"), null);
  assert.equal(parecidoDeNumero("00100004010000001349", "68847"), null);
  // Dos dígitos sueltos calzarían con cualquier cosa: no se aceptan.
  assert.equal(parecidoDeNumero("00100002010000129749", "49"), null);
});

// --- renglón contra renglón ------------------------------------------------

const r = (total: number, cantidad: number, precioUnitario: number) => ({ total, cantidad, precioUnitario });

test("cuenta cuántos renglones calzan por importe", () => {
  const c = cotejarRenglones(
    [r(745279.87, 128, 5152.654), r(225119.73, 30, 6640.7)],
    [r(745279.87, 128, 5152.654), r(225119.73, 30, 6640.7)],
  );
  assert.equal(c.calzan, 2);
  assert.deepEqual(c.sueltasCorreo, []);
  assert.deepEqual(c.sueltasBc, []);
});

test("calza aunque la unidad de compra sea otra, porque compara el importe", () => {
  // El proveedor factura 1 estañón a ₡255.000 y en BC entró como 255.000 gramos a ₡1.
  const c = cotejarRenglones([r(255000, 1, 255000)], [r(255000, 255000, 1)]);
  assert.equal(c.calzan, 1);
});

test("dice cuál renglón quedó suelto de cada lado", () => {
  const c = cotejarRenglones([r(100, 1, 100), r(250, 2, 125)], [r(100, 1, 100), r(999, 1, 999)]);
  assert.equal(c.calzan, 1);
  assert.deepEqual(c.sueltasCorreo, [1]);
  assert.deepEqual(c.sueltasBc, [1]);
});

test("un renglón de BC solo se usa una vez", () => {
  // Dos renglones iguales en el correo contra UNO en BC: calza uno, sobra uno.
  const c = cotejarRenglones([r(100, 1, 100), r(100, 1, 100)], [r(100, 1, 100)]);
  assert.equal(c.calzan, 1);
  assert.deepEqual(c.sueltasCorreo, [1]);
});
