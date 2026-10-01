// El "(s)" de "2 artículo(s)" se leía en pantalla: la app habla el español del
// oficio, no el de un formulario. `cuenta` arma la frase con las dos formas enteras.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cuenta } from "./helpers.ts";

test("uno va en singular y el resto en plural", () => {
  assert.equal(cuenta(1, "línea", "líneas"), "1 línea");
  assert.equal(cuenta(2, "línea", "líneas"), "2 líneas");
});

test("el cero va en plural, que es como se dice", () => {
  assert.equal(cuenta(0, "foto", "fotos"), "0 fotos");
});

test("la concordancia arrastra al participio, por eso van las formas enteras", () => {
  assert.equal(cuenta(1, "línea recibida", "líneas recibidas"), "1 línea recibida");
  assert.equal(cuenta(3, "línea recibida", "líneas recibidas"), "3 líneas recibidas");
});

test("sirve para los plurales que no son agregar una s", () => {
  assert.equal(cuenta(1, "vez", "veces"), "1 vez");
  assert.equal(cuenta(4, "vez", "veces"), "4 veces");
});
