// El freno del login: demora creciente por usuario, sin bloquear cuentas.
// Se prueba con el reloj simulado del runner de Node para poder saltar la ventana
// de 15 minutos sin esperarla. Corre con `npm test`.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { demoraPorFallos, registrarFallo, registrarExito, esperaAntesDeIntentar, pausaPorFallos, ipCliente, textoEspera, FALLOS_LIBRES, FALLOS_POR_IP } from "./login-throttle.ts";

test("la demora crece con cada fallo y tiene tope", () => {
  const u = "usuario-demora";
  assert.equal(demoraPorFallos(u), 0);          // primer intento: sin castigo
  registrarFallo(u);
  assert.equal(demoraPorFallos(u), 250);
  registrarFallo(u);
  assert.equal(demoraPorFallos(u), 500);
  for (let i = 0; i < 50; i++) registrarFallo(u);
  assert.equal(demoraPorFallos(u), 2000);       // tope, no crece para siempre
});

test("no distingue mayúsculas ni espacios", () => {
  registrarFallo("  Kattya ");
  assert.equal(demoraPorFallos("kattya"), 250);
});

test("un usuario no arrastra al otro (no se bloquea a nadie de rebote)", () => {
  registrarFallo("uno");
  registrarFallo("uno");
  assert.equal(demoraPorFallos("otro"), 0);
});

test("entrar bien limpia el contador", () => {
  const u = "usuario-exito";
  registrarFallo(u);
  registrarFallo(u);
  assert.ok(demoraPorFallos(u) > 0);
  registrarExito(u);
  assert.equal(demoraPorFallos(u), 0);
});

test("los fallos se olvidan pasada la ventana de 15 minutos", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-17T09:00:00Z") });
  try {
    const u = "usuario-ventana";
    registrarFallo(u);
    assert.equal(demoraPorFallos(u), 250);
    mock.timers.setTime(new Date("2026-08-17T09:16:00Z").getTime());   // +16 min
    assert.equal(demoraPorFallos(u), 0);
  } finally {
    mock.timers.reset();
  }
});

test("registrarFallo devuelve la cuenta del usuario (la usa el log de seguridad)", () => {
  const u = "conteo-log";
  registrarExito(u);
  assert.equal(registrarFallo(u), 1);
  assert.equal(registrarFallo(u), 2);
  assert.equal(registrarFallo("  CONTEO-LOG "), 3, "mismo usuario aunque cambien espacios y mayúsculas");
  registrarExito(u);
  assert.equal(registrarFallo(u), 1, "un login bueno reinicia la cuenta");
  registrarExito(u);
});

// ---------------------------------------------------------------------------
// Pausa dura (nov 2026). La demora de arriba no frena a quien manda muchos intentos
// en paralelo: cada uno espera su par de segundos AL MISMO TIEMPO. Pasados unos
// fallos, el siguiente intento ni siquiera mira la contraseña hasta que pase la pausa.
// ---------------------------------------------------------------------------
test("los primeros fallos son libres; después la pausa se duplica y tiene tope", () => {
  assert.equal(pausaPorFallos(FALLOS_LIBRES - 1), 0);
  assert.equal(pausaPorFallos(FALLOS_LIBRES), 30_000);
  assert.equal(pausaPorFallos(FALLOS_LIBRES + 1), 60_000);
  assert.equal(pausaPorFallos(FALLOS_LIBRES + 2), 120_000);
  assert.equal(pausaPorFallos(FALLOS_LIBRES + 50), 15 * 60_000);
});

test("pasados los fallos libres, el usuario tiene que esperar antes de volver a probar", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-04T09:00:00Z") });
  try {
    const u = "usuario-pausa";
    for (let i = 0; i < FALLOS_LIBRES - 1; i++) registrarFallo(u, "10.0.0.1");
    assert.equal(esperaAntesDeIntentar(u, "10.0.0.1"), null, "equivocarse unas veces no frena");
    registrarFallo(u, "10.0.0.1");
    const p = esperaAntesDeIntentar(u, "10.0.0.1");
    assert.equal(p?.por, "usuario");
    assert.equal(p?.ms, 30_000);
    mock.timers.setTime(new Date("2026-11-04T09:00:31Z").getTime());
    assert.equal(esperaAntesDeIntentar(u, "10.0.0.1"), null, "pasada la pausa se puede probar otra vez");
    registrarExito(u);
  } finally {
    mock.timers.reset();
  }
});

test("al que llegó a la pausa larga no se le regalan intentos libres cuando termina", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-04T10:00:00Z") });
  try {
    const u = "usuario-tope";
    for (let i = 0; i < FALLOS_LIBRES + 10; i++) registrarFallo(u);
    mock.timers.setTime(new Date("2026-11-04T10:16:00Z").getTime());   // terminó la pausa de 15 min
    assert.equal(esperaAntesDeIntentar(u, "?"), null);
    registrarFallo(u);                                                   // y vuelve a fallar
    assert.equal(esperaAntesDeIntentar(u, "?")?.ms, 15 * 60_000, "sigue en la pausa larga, no vuelve a cero");
    registrarExito(u);
  } finally {
    mock.timers.reset();
  }
});

test("la pausa de un usuario no frena a otro", () => {
  const u = "usuario-frenado";
  for (let i = 0; i < FALLOS_LIBRES + 2; i++) registrarFallo(u);
  assert.ok(esperaAntesDeIntentar(u, "?"));
  assert.equal(esperaAntesDeIntentar("compañero", "?"), null);
  registrarExito(u);
});

test("muchos usuarios distintos desde la misma IP: se frena la IP", () => {
  const ip = "200.1.2.3";
  for (let i = 0; i < FALLOS_POR_IP; i++) registrarFallo(`barrido-${i}`, ip);
  assert.equal(esperaAntesDeIntentar("otro-cualquiera", ip)?.por, "ip");
  assert.equal(esperaAntesDeIntentar("otro-cualquiera", "200.9.9.9"), null, "otra IP sigue libre");
});

test("la IP real es la ÚLTIMA de X-Forwarded-For (la que agrega Azure), sin el puerto", () => {
  assert.equal(ipCliente("200.119.186.55:51234"), "200.119.186.55");
  // Lo de adelante lo puede inventar cualquiera; la última la pone Azure.
  assert.equal(ipCliente("1.1.1.1, 2.2.2.2, 200.119.186.55:51234"), "200.119.186.55");
  assert.equal(ipCliente("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(ipCliente("2001:db8::1"), "2001:db8::1");
  assert.equal(ipCliente(""), "?");
  assert.equal(ipCliente(null), "?");
});

test("la espera se dice en palabras", () => {
  assert.equal(textoEspera(30_000), "30 segundos");
  assert.equal(textoEspera(60_000), "1 minuto");
  assert.equal(textoEspera(61_000), "2 minutos");
  assert.equal(textoEspera(15 * 60_000), "15 minutos");
});
