// La cache del bootstrap no puede ahorrar trabajo a costa de mostrar datos viejos:
// lo que se prueba acá es que una escritura siempre gana y que un fallo no la traba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCacheBootstrap, ttlDeEntorno } from "./bootstrap-cache.ts";
import { esEscrituraSql } from "./db.ts";

// Reloj de mentira: el TTL se prueba moviendo la hora, no esperando.
function reloj(t = 1_000_000) {
  return { ahora: () => t, avanzar: (ms: number) => { t += ms; } };
}

test("dos pestañas que caen juntas corren UNA sola carga", async () => {
  const c = reloj();
  const cache = crearCacheBootstrap<number>(10_000, c.ahora);
  let corridas = 0;
  let soltar: (v: number) => void = () => {};
  const calcular = () => { corridas++; return new Promise<number>((r) => { soltar = r; }); };

  const a = cache.obtener(calcular);
  const b = cache.obtener(calcular);
  soltar(7);
  assert.deepEqual([(await a).valor, (await b).valor], [7, 7]);
  assert.equal(corridas, 1);
  assert.equal((await b).fuente, "en-vuelo");
});

test("dentro de la ventana se reusa; pasada, se vuelve a consultar", async () => {
  const c = reloj();
  const cache = crearCacheBootstrap<number>(10_000, c.ahora);
  let corridas = 0;
  const calcular = async () => ++corridas;

  assert.equal((await cache.obtener(calcular)).fuente, "fresco");
  c.avanzar(9_000);
  const reusado = await cache.obtener(calcular);
  assert.equal(reusado.fuente, "cache");
  assert.equal(reusado.edadMs, 9_000);
  c.avanzar(2_000);
  assert.equal((await cache.obtener(calcular)).fuente, "fresco");
  assert.equal(corridas, 2);
});

test("una escritura invalida: quien acaba de guardar no ve la foto vieja", async () => {
  const c = reloj();
  const cache = crearCacheBootstrap<number>(60_000, c.ahora);
  let corridas = 0;
  const calcular = async () => ++corridas;

  await cache.obtener(calcular);
  cache.invalidar();
  assert.equal((await cache.obtener(calcular)).fuente, "fresco");
  assert.equal(corridas, 2);
});

test("lo que se estaba calculando cuando entró la escritura NO se cachea", async () => {
  const c = reloj();
  const cache = crearCacheBootstrap<number>(60_000, c.ahora);
  let corridas = 0;
  let soltar: (v: number) => void = () => {};
  const lenta = () => { corridas++; return new Promise<number>((r) => { soltar = r; }); };

  const enVuelo = cache.obtener(lenta);
  cache.invalidar();          // alguien guardó mientras la consulta iba a medio camino
  soltar(1);
  await enVuelo;
  // La siguiente NO puede recibir ese valor: nació antes de la escritura.
  assert.equal((await cache.obtener(async () => 2)).valor, 2);
});

test("un fallo no se cachea ni deja la cache trabada", async () => {
  const c = reloj();
  const cache = crearCacheBootstrap<number>(60_000, c.ahora);
  await assert.rejects(cache.obtener(async () => { throw new Error("la base no contestó"); }));
  assert.equal((await cache.obtener(async () => 5)).valor, 5);
});

test("con la ventana en 0 queda el comportamiento de antes: siempre consulta", async () => {
  const c = reloj();
  const cache = crearCacheBootstrap<number>(0, c.ahora);
  let corridas = 0;
  const calcular = async () => ++corridas;
  await cache.obtener(calcular);
  await cache.obtener(calcular);
  assert.equal(corridas, 2);
});

test("la ventana se lee del entorno, con techo y con default", () => {
  assert.equal(ttlDeEntorno(undefined), 10_000);
  assert.equal(ttlDeEntorno(""), 10_000);
  assert.equal(ttlDeEntorno("0"), 0);            // apagada a mano
  assert.equal(ttlDeEntorno("25"), 25_000);
  assert.equal(ttlDeEntorno("9999"), 60_000);    // techo: nunca más vieja que un minuto
  assert.equal(ttlDeEntorno("-3"), 10_000);      // basura → default
  assert.equal(ttlDeEntorno("ayer"), 10_000);
});


// ---- QUIÉN BOTA LA FOTO -------------------------------------------------------
// La invalidación está enganchada en lib/db.ts, en el único punto por el que pasan
// todas las consultas, y decide por el TEXTO de la sentencia. Si esto se equivoca
// hacia el lado flojo, alguien pide la lista justo después de guardar y la recibe
// sin lo suyo — que en esta app termina en un documento registrado dos veces.
test("escritura: INSERT, UPDATE, DELETE y MERGE botan la foto", () => {
  assert.equal(esEscrituraSql("INSERT INTO dbo.OrdenCompra (x) VALUES (1)"), true);
  assert.equal(esEscrituraSql("UPDATE dbo.FacturaCorreo SET estado='rechazada'"), true);
  assert.equal(esEscrituraSql("DELETE FROM dbo.Movimiento WHERE id=1"), true);
  assert.equal(esEscrituraSql("MERGE dbo.Estado AS t USING ..."), true);
  // Las de verdad vienen con saltos de línea y sangría, como las escribe repo.ts.
  assert.equal(esEscrituraSql(`
      UPDATE f SET estado = 'rechazada'
      FROM dbo.FacturaCorreo f`), true);
});

test("escritura: una LECTURA no bota nada (si no, la cache no serviría de nada)", () => {
  assert.equal(esEscrituraSql("SELECT * FROM dbo.OrdenCompra WHERE esEliminada = 0"), false);
  assert.equal(esEscrituraSql("SELECT OBJECT_ID('dbo.FacturaCorreo') AS id"), false);
  assert.equal(esEscrituraSql(""), false);
  assert.equal(esEscrituraSql(undefined), false);
});

test("escritura: un SELECT que MENCIONA la palabra en un texto sí bota la foto", () => {
  // Falso positivo asumido: botar de más cuesta una consulta, botar de menos cuesta
  // que alguien no vea lo que acaba de guardar. La asimetría manda.
  assert.equal(esEscrituraSql("SELECT * FROM dbo.Movimiento WHERE detalle LIKE '%update%'"), true);
});
