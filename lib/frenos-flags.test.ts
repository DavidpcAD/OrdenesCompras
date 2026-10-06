// LOS INTERRUPTORES DE LOS FRENOS, Y EL AVISO QUE NO HAY QUE DAR.
//
// Cuatro frenos de Business Central se pueden apagar por variable de entorno (la pared
// de aprobación, el de registro, el de proveedor y el de precio). Lo que estas pruebas cuidan es
// que estén ENCENDIDOS salvo que alguien los apague a propósito y bien escrito: un
// freno que se apaga solo por un typo en Azure no es un freno, y estos tres existen
// porque ya hubo plata mal puesta (CP-005183: una factura de ₡425.034,36 de EPA
// quedó en la cuenta de otro proveedor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { paredAprobacionActiva, frenoRegistroActivo, frenoProveedorActivo, frenoPrecioActivo, chequeoAplica } from "./bc.ts";

const FLAGS = [
  ["BC_PARED_APROBACION", paredAprobacionActiva],
  ["BC_FRENO_REGISTRO", frenoRegistroActivo],
  ["BC_FRENO_PROVEEDOR", frenoProveedorActivo],
  ["BC_FRENO_PRECIO", frenoPrecioActivo],
] as const;

const con = (clave: string, valor: string | undefined, fn: () => boolean) => {
  const previo = process.env[clave];
  if (valor === undefined) delete process.env[clave];
  else process.env[clave] = valor;
  try { return fn(); } finally {
    if (previo === undefined) delete process.env[clave]; else process.env[clave] = previo;
  }
};

test("sin la variable puesta, los cuatro frenos están ENCENDIDOS", () => {
  // El default seguro: una app recién desplegada frena, no pasa de largo.
  for (const [clave, fn] of FLAGS) assert.equal(con(clave, undefined, fn), true, clave);
});

test("se apagan solo con 0, false o no", () => {
  for (const [clave, fn] of FLAGS)
    for (const v of ["0", "false", "no", "FALSE", "No", "  0  "])
      assert.equal(con(clave, v, fn), false, `${clave}=${JSON.stringify(v)}`);
});

test("un typo NO apaga el freno: cualquier otra cosa lo deja encendido", () => {
  // "fasle" en una variable de Azure no puede dejar pasar un pedido del proveedor
  // equivocado sin que nadie se entere.
  for (const [clave, fn] of FLAGS)
    for (const v of ["fasle", "nope", "off", "1", "true", "sí", "", "null", "undefined"])
      assert.equal(con(clave, v, fn), true, `${clave}=${JSON.stringify(v)}`);
});

// ── Cuándo el resultado del cotejo merece un aviso ────────────────────────────
test("a una orden COMPLETADA no se le dice que BC no tiene el pedido", () => {
  // Purch.-Post borra el pedido cuando ya se recibió y facturó todo: ahí no hay
  // nada roto. Ese falso positivo fue el que hizo que nadie mirara el aviso cuando
  // SÍ estaba roto.
  assert.equal(chequeoAplica("sin-pedido", "completado"), false);
  assert.equal(chequeoAplica("sin-pedido", "lanzado"), true);
});

test("'desalineado' se avisa siempre: la plata ya no cuadra", () => {
  for (const estadoOrden of ["abierto", "lanzado", "completado", "rechazado", ""])
    assert.equal(chequeoAplica("desalineado", estadoOrden), true, estadoOrden);
});

test("ni 'ok' ni 'no se pudo ver' son motivo de aviso", () => {
  // "sin-lectura" es un hecho sobre la RED, no sobre BC: no se afirma nada.
  assert.equal(chequeoAplica("ok", "lanzado"), false);
  assert.equal(chequeoAplica("sin-lectura", "lanzado"), false);
});
