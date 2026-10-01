// El mensaje de mssql dice servidor, base y puerto; el que lanza nuestro código dice
// qué hacer. Hay que poder distinguirlos sin mirar qué tan feo se ve el texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mensajeParaPantalla, vieneDelMotor } from "./error-sql.ts";

const comoMssql = (name: string, code: string, message: string) => Object.assign(new Error(message), { name, code });

test("el error de conexión no cuenta el servidor ni el puerto", () => {
  const e = comoMssql("ConnectionError", "ESOCKET", "Failed to connect to mysqladelante.database.windows.net:1433");
  assert.equal(vieneDelMotor(e), true);
  const m = mensajeParaPantalla(e, "No se pudo guardar la vista");
  assert.match(m, /la base no contestó/);
  assert.doesNotMatch(m, /1433|windows\.net|mysqladelante/);
});

test("el error de consulta tampoco: nombra tablas y columnas", () => {
  const e = comoMssql("RequestError", "EREQUEST", "Invalid column name 'esPredeterminada' en dbo.VistaTabla");
  const m = mensajeParaPantalla(e, "No se pudo guardar la vista");
  assert.doesNotMatch(m, /dbo\.|esPredeterminada/);
});

test("lo que lanza NUESTRO código sí se muestra: es lo que dice qué hacer", () => {
  const e = new Error("Faltan usuario, tabla o nombre");
  assert.equal(vieneDelMotor(e), false);
  assert.equal(mensajeParaPantalla(e, "No se pudo guardar la vista"),
    "No se pudo guardar la vista: Faltan usuario, tabla o nombre");
});

test("un error de negocio con palabras feas NO se confunde con uno del motor", () => {
  const e = new Error("Ya hay una factura registrada con ese número para CP-005814");
  assert.equal(vieneDelMotor(e), false);
  assert.match(mensajeParaPantalla(e, "No se registró"), /CP-005814/);
});

test("sin mensaje queda la frase sola, no un 'undefined' en pantalla", () => {
  assert.equal(mensajeParaPantalla(new Error(""), "No se pudo guardar la vista"), "No se pudo guardar la vista.");
  assert.equal(mensajeParaPantalla(null, "No se pudo guardar la vista"), "No se pudo guardar la vista.");
});

test("se reconoce el error del motor aunque venga sin name ni code", () => {
  assert.equal(vieneDelMotor(new Error("Failed to connect to 10.0.0.4:1433 - timeout")), true);
});
