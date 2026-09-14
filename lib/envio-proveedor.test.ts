import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leerSello, envioDeSello, resumenEnvio, vaAlProveedor,
  MOV_PDF, MOV_ENVIADA, MOV_DESHECHO, SELLO_SEP,
} from "./envio-proveedor.ts";
import type { Orden } from "./types.ts";

const sello = (fecha: string, usuario: string, tipo: string) => [fecha, usuario, tipo].join(SELLO_SEP);

test("el sello se lee con fecha, persona y tipo", () => {
  const s = leerSello(sello("2026-09-11T15:14:02.120", "Angie", MOV_PDF));
  assert.deepEqual(s, { fecha: "2026-09-11T15:14:02.120", usuario: "Angie", tipo: MOV_PDF });
});

test("un sello sin persona no inventa el nombre", () => {
  assert.equal(leerSello(sello("2026-09-11T15:14:02.120", "", MOV_PDF))?.usuario, undefined);
});

test("sin sello (orden que nunca salió) no hay envío", () => {
  assert.equal(leerSello(null), undefined);
  assert.equal(leerSello(""), undefined);
  assert.equal(envioDeSello(undefined), undefined);
});

test("el MAX de SQL se queda con el movimiento más nuevo porque la fecha va en ISO", () => {
  const viejo = sello("2026-09-11T09:00:00.000", "Angie", MOV_PDF);
  const nuevo = sello("2026-09-11T15:14:02.120", "Angie", MOV_ENVIADA);
  assert.equal([viejo, nuevo].sort().at(-1), nuevo);
});

test("bajar el PDF marca la orden como enviada, y no como marca manual", () => {
  const e = envioDeSello(leerSello(sello("2026-09-11T15:14:02.120", "Angie", MOV_PDF)));
  assert.equal(e?.fecha, "2026-09-11T15:14:02.120");
  assert.equal(e?.manual, false);
});

test("la marca a mano queda señalada como manual", () => {
  assert.equal(envioDeSello(leerSello(sello("2026-09-11T15:14:02.120", "Angie", MOV_ENVIADA)))?.manual, true);
});

test("si lo último fue quitar la marca, la orden NO está enviada", () => {
  assert.equal(envioDeSello(leerSello(sello("2026-09-12T08:00:00.000", "Angie", MOV_DESHECHO))), undefined);
});

test("al proveedor solo salen las lanzadas y las completadas", () => {
  assert.equal(vaAlProveedor({ estado: "lanzado" }), true);
  assert.equal(vaAlProveedor({ estado: "completado" }), true);
  assert.equal(vaAlProveedor({ estado: "abierto" }), false);
  assert.equal(vaAlProveedor({ estado: "pendiente_aprobacion" }), false);
  assert.equal(vaAlProveedor({ estado: "rechazado" }), false);
});

test("el contador dice cuántas faltan por mandar, sin contar las que no salen", () => {
  const o = (estado: Orden["estado"], enviada?: boolean, aprobada?: boolean) => ({
    estado,
    envioProveedor: enviada ? { fecha: "2026-09-11T15:14:02.120" } : undefined,
    aprobacion: aprobada ? { fecha: "2026-09-11T08:00:00.000" } : undefined,
  });
  const r = resumenEnvio([
    o("lanzado", true, true), o("lanzado", true, true), o("lanzado", false, true),
    o("completado", false, true),
    o("abierto"), o("pendiente_aprobacion"),
  ]);
  assert.equal(r.total, 6);
  assert.equal(r.alProveedor, 4);
  assert.equal(r.enviadas, 2);
  assert.equal(r.faltan, 2);
  assert.equal(r.conFechaAprobacion, 4);
});

test("sin órdenes el contador no truena ni deja negativos", () => {
  assert.deepEqual(resumenEnvio([]), { total: 0, alProveedor: 0, enviadas: 0, faltan: 0, conFechaAprobacion: 0 });
});
