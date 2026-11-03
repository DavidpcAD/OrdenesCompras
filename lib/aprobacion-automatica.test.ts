// QUIÉN NO NECESITA A LUIS ROBERTO.
//
// Lanzar sin aprobación es soltar plata sin que nadie la mire, así que lo que estas
// pruebas cuidan es el borde: que el tope sea estricto, que una divisa nunca pase por
// monto, que sin el total de BC no se suelte nada por monto, y que Holcim sea la única
// excepción de proveedor.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aprobacionAutomatica, aprobacionAutomaticaActiva, avisoAntesDeEnviar, esMonedaLocal,
  TOPE_SIN_APROBACION_CRC,
} from "./aprobacion-automatica.ts";

const crc = { proveedorNo: "PROV-000522", currencyCode: "" };

test("colones bajo el tope: se lanza sola, con el motivo del monto", () => {
  const d = aprobacionAutomatica(crc, { app: 185_300, bc: 185_300 });
  assert.equal(d.aplica, true);
  assert.equal(d.aplica && d.motivo, "monto");
});

test("el tope es estricto: ₡210 000 exactos ya van a aprobación", () => {
  assert.equal(aprobacionAutomatica(crc, { app: TOPE_SIN_APROBACION_CRC, bc: TOPE_SIN_APROBACION_CRC }).aplica, false);
  assert.equal(aprobacionAutomatica(crc, { app: 209_999.99, bc: 209_999.99 }).aplica, true);
});

test("manda el MAYOR de los dos totales: si BC cobra más IVA que el estimado, va a aprobación", () => {
  // CP-005652: la orden decía 1 % y BC cobró 13 %. El estimado no puede soltarla.
  assert.equal(aprobacionAutomatica(crc, { app: 200_000, bc: 215_000 }).aplica, false);
  assert.equal(aprobacionAutomatica(crc, { app: 215_000, bc: 200_000 }).aplica, false);
});

test("si BC no contestó el total, la regla del monto no aplica", () => {
  assert.equal(aprobacionAutomatica(crc, { app: 50_000, bc: null }).aplica, false);
});

test("sin preguntarle a BC (la pantalla antes de enviar) decide con el estimado", () => {
  assert.equal(aprobacionAutomatica(crc, { app: 50_000 }).aplica, true);
});

test("dólares y euros van SIEMPRE a aprobación, aunque el número sea chico", () => {
  for (const currencyCode of ["USD", "EURO", "usd"])
    assert.equal(aprobacionAutomatica({ ...crc, currencyCode }, { app: 300, bc: 300 }).aplica, false, currencyCode);
});

test("una orden en cero no se lanza sola", () => {
  assert.equal(aprobacionAutomatica(crc, { app: 0, bc: 0 }).aplica, false);
});

test("Holcim se lanza sola sea cual sea el monto, aunque BC no conteste", () => {
  for (const bc of [3_149_137.68, null, undefined]) {
    const d = aprobacionAutomatica({ proveedorNo: "PROV-000694", currencyCode: "" }, { app: 3_149_137.68, bc });
    assert.equal(d.aplica && d.motivo, "proveedor", String(bc));
  }
  // El código llega a veces en proveedorId (es el CÓDIGO, no un GUID) y en minúscula.
  assert.equal(aprobacionAutomatica({ proveedorId: " prov-000694 " }, { app: 1 }).aplica, true);
});

test("la Asociación Solidarista de Holcim NO es Holcim", () => {
  assert.equal(aprobacionAutomatica({ proveedorNo: "PROV-000435", currencyCode: "" }, { app: 900_000, bc: 900_000 }).aplica, false);
});

test("'' y CRC son colones; lo demás es divisa", () => {
  assert.equal(esMonedaLocal(""), true);
  assert.equal(esMonedaLocal(undefined), true);
  assert.equal(esMonedaLocal(" crc "), true);
  assert.equal(esMonedaLocal("USD"), false);
});

const con = (valor: string | undefined, fn: () => unknown) => {
  const previo = process.env.APROBACION_AUTOMATICA;
  if (valor === undefined) delete process.env.APROBACION_AUTOMATICA; else process.env.APROBACION_AUTOMATICA = valor;
  try { return fn(); } finally {
    if (previo === undefined) delete process.env.APROBACION_AUTOMATICA; else process.env.APROBACION_AUTOMATICA = previo;
  }
};

test("el interruptor: encendido por defecto, se apaga solo con 0/false/no", () => {
  assert.equal(con(undefined, aprobacionAutomaticaActiva), true);
  for (const v of ["0", "false", "NO", " 0 "]) assert.equal(con(v, aprobacionAutomaticaActiva), false, v);
  for (const v of ["1", "si", "O", ""]) assert.equal(con(v, aprobacionAutomaticaActiva), true, v);
});

test("el aviso del diálogo sale solo cuando aplica, y se calla con el interruptor apagado", () => {
  assert.match(String(avisoAntesDeEnviar(crc, 100_000)), /no pasa por aprobación/);
  assert.match(String(avisoAntesDeEnviar({ proveedorNo: "PROV-000694" }, 3_000_000)), /^Holcim/);
  assert.equal(avisoAntesDeEnviar(crc, 300_000), null);
  assert.equal(con("0", () => avisoAntesDeEnviar(crc, 100_000)), null);
});
