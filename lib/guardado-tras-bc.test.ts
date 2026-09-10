import { test } from "node:test";
import assert from "node:assert/strict";
import { guardarRecepcionTrasBc } from "./guardado-tras-bc.ts";

const QUIEN = { usuario: "Pedro", rol: "facturacion" as const };
const REC = {
  idOrdenCompra: 268, numeroFactura: "19741",
  fechaFactura: "2026-09-10", fechaRecepcion: "2026-09-10", fechaRegistro: "2026-09-10",
  total: 973359.85, lineas: [{ idOrdenCompraDet: 900, cantidadRecibida: 5 }],
};

test("sin payload no guarda nada (modo mock): el posteo a BC se responde igual", async () => {
  let llamadas = 0;
  const r = await guardarRecepcionTrasBc(undefined, "CFR-010109", QUIEN, 268, async () => { llamadas++; return 1; });
  assert.deepEqual(r, {});
  assert.equal(llamadas, 0);
});

test("guarda la recepción y devuelve su id", async () => {
  const r = await guardarRecepcionTrasBc(REC, "CFR-010109", QUIEN, 268, async () => 777);
  assert.equal(r.recepcionId, 777);
  assert.equal(r.errorLocal, undefined);
});

test("el N.º de BC y el autor los pone el SERVIDOR, no el navegador", async () => {
  let visto: any = null;
  // El cuerpo intenta colar otro usuario y otro N.º de factura de BC.
  const sucio = { ...REC, usuario: "Angie", rol: "proveeduria", bcFacturaNo: "CFR-000000" } as any;
  await guardarRecepcionTrasBc(sucio, "CFR-010109", QUIEN, 268, async (i) => { visto = i; return 1; });
  assert.equal(visto.usuario, "Pedro");
  assert.equal(visto.rol, "facturacion");
  assert.equal(visto.bcFacturaNo, "CFR-010109");
});

test("la recepción tiene que ser de la MISMA orden contra la que se posteó", async () => {
  let llamadas = 0;
  const r = await guardarRecepcionTrasBc({ ...REC, idOrdenCompra: 999 }, "CFR-010109", QUIEN, 268, async () => { llamadas++; return 1; });
  assert.equal(llamadas, 0, "no se guarda en otra orden");
  assert.match(String(r.errorLocal), /999.*268|268.*999/);
});

test("sin id de orden no se guarda a ciegas", async () => {
  let llamadas = 0;
  const r = await guardarRecepcionTrasBc({ ...REC, idOrdenCompra: undefined } as any, "CFR-010109", QUIEN, 268, async () => { llamadas++; return 1; });
  assert.equal(llamadas, 0);
  assert.match(String(r.errorLocal), /id de la orden/i);
});

test("si la base falla, el error VUELVE (no se traga): BC ya registró y hay que decirlo", async () => {
  const r = await guardarRecepcionTrasBc(REC, "CFR-010109", QUIEN, 268, async () => { throw new Error("Timeout: request failed"); });
  assert.equal(r.recepcionId, undefined);
  assert.match(String(r.errorLocal), /Timeout/);
});

test("sin ordenIdEsperada (llamada vieja) igual guarda: el freno no puede trabar el flujo", async () => {
  const r = await guardarRecepcionTrasBc(REC, "", QUIEN, undefined, async () => 42);
  assert.equal(r.recepcionId, 42);
});
