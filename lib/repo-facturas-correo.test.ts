import test from "node:test";
import assert from "node:assert/strict";
import { sinClavesRepetidas } from "./repo-facturas-correo.ts";
import type { Comprobante } from "./cruce-correo-bc.ts";

// El caso real del 23 sep 2026: dos correos con el MISMO comprobante en una sola
// corrida tumbaban el INSERT de toda la tanda por llave primaria repetida, y con él
// la lectura del buzón. Acá se prueba la regla que lo evita.

const CLAVE_A = "50623092600310167373600100001010000049792102201501";
const CLAVE_B = "50610092600310138290900100002010000019741100000001";

const comp = (clave: string): Comprobante => ({
  clave,
  consecutivo: clave.slice(21, 41),
  tipo: "01",
  cedulaEmisor: clave.slice(12, 24),
  nombreEmisor: "PROVEEDOR S.A.",
  cedulaReceptor: "3101234567",
  fecha: "2026-09-22",
  total: 129950,
  moneda: "CRC",
});

const entrada = (clave: string, fechaCorreo?: string, webLink = "") =>
  ({ comprobante: comp(clave), fechaCorreo, webLink });

test("el mismo comprobante dos veces en la misma tanda sale una sola vez", () => {
  const r = sinClavesRepetidas([
    entrada(CLAVE_A, "2026-09-22T08:00:00Z"),
    entrada(CLAVE_B, "2026-09-22T09:00:00Z"),
    entrada(CLAVE_A, "2026-09-22T15:30:00Z"),
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((e) => e.comprobante.clave), [CLAVE_A, CLAVE_B]);
});

test("gana el correo que llegó primero, no el reenvío", () => {
  // Si se quedara con el reenvío, la espera de esa factura se borraría: la pantalla
  // cuenta los días desde que el correo entró.
  const r = sinClavesRepetidas([
    entrada(CLAVE_A, "2026-09-22T15:30:00Z", "reenvio"),
    entrada(CLAVE_A, "2026-09-22T08:00:00Z", "original"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].fechaCorreo, "2026-09-22T08:00:00Z");
  assert.equal(r[0].webLink, "original");
});

test("una copia sin fecha pierde contra la que sí la tiene", () => {
  const r = sinClavesRepetidas([
    entrada(CLAVE_A, undefined, "sin fecha"),
    entrada(CLAVE_A, "2026-09-22T08:00:00Z", "con fecha"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].webLink, "con fecha");
});

test("si ninguna tiene fecha se queda la primera y no se cae", () => {
  const r = sinClavesRepetidas([
    entrada(CLAVE_A, undefined, "primera"),
    entrada(CLAVE_A, "", "segunda"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].webLink, "primera");
});

test("sin repetidas devuelve todo, en el mismo orden", () => {
  const r = sinClavesRepetidas([entrada(CLAVE_B, "2026-09-10T07:00:00Z"), entrada(CLAVE_A, "2026-09-22T08:00:00Z")]);
  assert.deepEqual(r.map((e) => e.comprobante.clave), [CLAVE_B, CLAVE_A]);
});

test("una lista vacía no rompe", () => {
  assert.deepEqual(sinClavesRepetidas([]), []);
});
