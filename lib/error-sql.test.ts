// El mensaje de mssql dice servidor, base y puerto; el que lanza nuestro código dice
// qué hacer. Hay que poder distinguirlos sin mirar qué tan feo se ve el texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mensajeParaPantalla, mensajeSeguro, vieneDelMotor } from "./error-sql.ts";

const comoMssql = (name: string, code: string, message: string) => Object.assign(new Error(message), { name, code });

// Taparlo en pantalla y anotarlo en el log son la misma función, así que las pruebas
// del mensaje tienen que atrapar el log: si no, `npm test` escupe trazas de errores
// inventados y parece que algo se rompió. De paso, lo atrapado es lo que se verifica.
function conLog<T>(fn: () => T): { valor: T; log: string } {
  const real = console.error;
  const lineas: string[] = [];
  console.error = (...xs: unknown[]) => { lineas.push(xs.map(String).join(" ")); };
  try { return { valor: fn(), log: lineas.join("\n") }; } finally { console.error = real; }
}

test("el error de conexión no cuenta el servidor ni el puerto", () => {
  const e = comoMssql("ConnectionError", "ESOCKET", "Failed to connect to mysqladelante.database.windows.net:1433");
  assert.equal(vieneDelMotor(e), true);
  const m = conLog(() => mensajeParaPantalla(e, "No se pudo guardar la vista")).valor;
  assert.match(m, /la base no contestó/);
  assert.doesNotMatch(m, /1433|windows\.net|mysqladelante/);
});

test("el error de consulta tampoco: nombra tablas y columnas", () => {
  const e = comoMssql("RequestError", "EREQUEST", "Invalid column name 'esPredeterminada' en dbo.VistaTabla");
  const m = conLog(() => mensajeParaPantalla(e, "No se pudo guardar la vista")).valor;
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

test("mensajeSeguro deja IGUAL lo que no viene del motor (cambiar una ruta no toca nada)", () => {
  assert.equal(mensajeSeguro(new Error("Ya hay una recepción con esa factura")), "Ya hay una recepción con esa factura");
  // Los de Business Central tampoco se tocan: son los que explican qué arreglar allá.
  assert.equal(mensajeSeguro(new Error("BC 400: Gen. Bus. Posting Group no está en la ficha")),
    "BC 400: Gen. Bus. Posting Group no está en la ficha");
});

test("mensajeSeguro sí tapa el del motor, sin frase de adelante", () => {
  const e = Object.assign(new Error("Failed to connect to mysqladelante.database.windows.net:1433"), { name: "ConnectionError" });
  assert.equal(conLog(() => mensajeSeguro(e)).valor, "la base no contestó. Reintentá y, si sigue, avisale a TI");
});

// ── El crudo no se muestra, pero TIENE que quedar ──────────────────────────────
// Sin esto, una captura con "la base no contestó" no se puede diagnosticar: fue lo
// que pasó el 5 oct 2026 con una orden que no se pudo crear.

test("el crudo del motor queda en el log del server, aunque la pantalla no lo vea", () => {
  const e = comoMssql("ConnectionError", "ESOCKET", "Failed to connect to mysqladelante.database.windows.net:1433");
  const { valor, log } = conLog(() => mensajeParaPantalla(e, "No se pudo crear la orden"));
  assert.doesNotMatch(valor, /1433/);
  assert.match(log, /mysqladelante\.database\.windows\.net:1433/);
  assert.match(log, /ESOCKET/);
  assert.match(log, /No se pudo crear la orden/);
});

test("el log trae el número de error de SQL y el rótulo de la ruta", () => {
  // 8152: "String or binary data would be truncated" — el que dice QUÉ arreglar.
  const e = Object.assign(comoMssql("RequestError", "EREQUEST", "String or binary data would be truncated in dbo.OrdenCompra"),
    { number: 8152, originalError: new Error("Statement(s) could not be prepared") });
  const { log } = conLog(() => mensajeSeguro(e, "POST /api/ordenes · crear orden"));
  assert.match(log, /nro=8152/);
  assert.match(log, /POST \/api\/ordenes/);
  assert.match(log, /driver: Statement\(s\) could not be prepared/);
});

test("lo que NO viene del motor no se loguea: ya se lee en pantalla", () => {
  const { log } = conLog(() => mensajeSeguro(new Error("Ya hay una factura con ese número")));
  assert.equal(log, "");
});
