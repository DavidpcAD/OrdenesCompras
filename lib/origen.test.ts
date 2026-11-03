import { test } from "node:test";
import assert from "node:assert/strict";
import { origenAjeno } from "./origen.ts";

const APP = "app-ordenescompra-eus2.azurewebsites.net";

test("una escritura desde la misma app pasa", () => {
  assert.equal(origenAjeno("POST", `https://${APP}`, APP, ""), null);
  assert.equal(origenAjeno("patch", `https://${APP.toUpperCase()}`, APP, ""), null);
});

test("una escritura desde otro sitio se corta", () => {
  assert.equal(origenAjeno("POST", "https://malo.example", APP, ""), "https://malo.example");
  assert.equal(origenAjeno("DELETE", "https://app-otra.azurewebsites.net", APP, ""), "https://app-otra.azurewebsites.net");
});

test("Origin 'null' o basura se corta", () => {
  assert.equal(origenAjeno("POST", "null", APP, ""), "null");
});

test("las lecturas y los pedidos sin Origin no se tocan", () => {
  assert.equal(origenAjeno("GET", "https://malo.example", APP, ""), null);
  assert.equal(origenAjeno("POST", null, APP, ""), null);
});

test("el puerto cuenta como parte del sitio (local)", () => {
  assert.equal(origenAjeno("POST", "http://localhost:3000", "localhost:3000", ""), null);
  assert.equal(origenAjeno("POST", "http://localhost:3001", "localhost:3000", ""), "http://localhost:3001");
});

test("vale cualquiera de los nombres con que llegó el request", () => {
  assert.equal(origenAjeno("POST", `https://${APP}`, `interno.local,${APP}`, ""), null);
  assert.equal(origenAjeno("POST", "https://malo.example", `interno.local,${APP}`, ""), "https://malo.example");
});

test("ORIGENES_PERMITIDOS deja pasar un dominio propio extra", () => {
  assert.equal(origenAjeno("POST", "https://compras.adelante.cr", APP, "compras.adelante.cr, otro.cr"), null);
});
