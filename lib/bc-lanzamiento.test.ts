// ¿QUEDÓ LANZADO? La aprobación automática (menor a ₡210 000 u Holcim) marca la orden
// lanzada sin que Luis la vea, así que "lanzado" tiene que ser algo que BC dijo, no
// algo que la app supuso. Antes un 200 del ReleaseOrder sin cuerpo valía "Released"
// por defecto. Ojo con el vocabulario: esto es el enum del CODEUNIT (Open = Abierto),
// no el `status` de la API v2.0 (ahí "Open" es lanzado).
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoTrasLanzar } from "./bc.ts";

test("BC contestó sin estado y no se pudo releer: NO es lanzado", () => {
  assert.equal(estadoTrasLanzar("", undefined).estado, "desconocido");
  assert.equal(estadoTrasLanzar("", "").estado, "desconocido");
});

test("manda lo que se releyó, aunque el codeunit haya dicho Released", () => {
  const r = estadoTrasLanzar("Released", "Open");
  assert.equal(r.estado, "abierto");
  assert.equal(r.status, "Open");
});

test("el workflow de BC lo tomó: queda pendiente de aprobación, no lanzado", () => {
  assert.equal(estadoTrasLanzar("Released", "Pending Approval").estado, "pendiente-aprobacion");
});

test("releído lanzado: lanzado (en inglés o en español, según la sesión)", () => {
  assert.equal(estadoTrasLanzar("", "Released").estado, "lanzado");
  assert.equal(estadoTrasLanzar("Released", "Lanzado").estado, "lanzado");
});

test("sin poder releer, vale lo que dijo el codeunit si lo dijo", () => {
  assert.equal(estadoTrasLanzar("Released", undefined).estado, "lanzado");
  assert.equal(estadoTrasLanzar("Open", undefined).estado, "abierto");
});
