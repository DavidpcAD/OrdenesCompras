// La sesión dura 30 días; esto es lo que permite CORTARLA desde afuera: cambiar la
// contraseña, quitar el rol o borrar al usuario cierra sus sesiones abiertas. Si esto
// se rompe, una sesión robada o de alguien que ya se fue vive para siempre.
// Corre con `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearRevisor, juzgarSesion, REVISAR_CADA_MS, type EstadoCuenta } from "./sesion-vigente.ts";
import type { SessionPayload } from "./session.ts";

const cookie = (extra: Partial<SessionPayload> = {}): SessionPayload =>
  ({ u: "angie", r: "proveeduria", n: "Angie", exp: 9e9, h: "huella-1", ...extra });
const cuenta = (extra: Partial<Extract<EstadoCuenta, { existe: true }>> = {}): EstadoCuenta =>
  ({ existe: true, huella: "huella-1", role: "proveeduria", ...extra });

test("misma clave, mismo rol: sigue", () => {
  assert.deepEqual(juzgarSesion(cookie(), cuenta()), { vigente: true });
});

test("cambiar la contraseña cierra la sesión", () => {
  const v = juzgarSesion(cookie(), cuenta({ huella: "huella-2" }));
  assert.equal(v.vigente, false);
  assert.equal(!v.vigente && v.motivo, "otra-clave");
});

test("usuario borrado, sin rol o con otro módulo: se cierra", () => {
  const motivo = (c: EstadoCuenta) => { const v = juzgarSesion(cookie(), c); return v.vigente ? null : v.motivo; };
  assert.equal(motivo({ existe: false }), "sin-usuario");
  assert.equal(motivo(cuenta({ role: undefined })), "sin-rol");
  assert.equal(motivo(cuenta({ role: "facturacion" })), "otro-rol");
});

test("cada cierre trae un mensaje que dice qué pasó y qué hacer", () => {
  for (const c of [{ existe: false } as EstadoCuenta, cuenta({ role: undefined }), cuenta({ role: "contabilidad" }), cuenta({ huella: "x" })]) {
    const v = juzgarSesion(cookie(), c);
    assert.ok(!v.vigente && v.mensaje.length > 20);
  }
});

test("cookie vieja sin huella: no se corta por la clave (vence sola), sí por el rol", () => {
  assert.equal(juzgarSesion(cookie({ h: undefined }), cuenta({ huella: "cualquiera" })).vigente, true);
  assert.equal(juzgarSesion(cookie({ h: undefined }), { existe: false }).vigente, false);
});

// ---- el revisor: caché, base caída y lectura fresca antes de cortar ----
function reloj(t0 = 1_000_000) {
  let t = t0;
  return { ahora: () => t, avanzar: (ms: number) => { t += ms; } };
}

test("no consulta el padrón en cada request: confía en la última lectura unos minutos", async () => {
  let lecturas = 0;
  const r = reloj();
  const revisar = crearRevisor(async () => { lecturas++; return cuenta(); }, r.ahora);
  await revisar(cookie());
  await revisar(cookie());
  await revisar(cookie());
  assert.equal(lecturas, 1);
  r.avanzar(REVISAR_CADA_MS + 1);
  await revisar(cookie());
  assert.equal(lecturas, 2, "pasado el plazo vuelve a mirar");
});

test("el cambio de clave se nota a más tardar en un plazo de revisión", async () => {
  let huella = "huella-1";
  const r = reloj();
  const revisar = crearRevisor(async () => cuenta({ huella }), r.ahora);
  assert.equal((await revisar(cookie())).vigente, true);
  huella = "huella-2";                       // le cambian la clave en ControlUsuarios
  r.avanzar(REVISAR_CADA_MS + 1);
  assert.equal((await revisar(cookie())).vigente, false);
});

test("si la base no contesta, NO se echa a nadie", async () => {
  const revisar = crearRevisor(async () => { throw new Error("timeout"); }, reloj().ahora);
  const avisos: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { avisos.push(a); };
  try {
    assert.deepEqual(await revisar(cookie()), { vigente: true });
  } finally {
    console.warn = warn;
  }
  assert.equal(avisos.length, 1, "queda en el log de Azure");
});

test("recién cambió la clave y entró con la nueva: la caché vieja no la echa", async () => {
  // La caché tiene la huella VIEJA; la cookie nueva trae la nueva. Antes de cortar se
  // lee de nuevo, y la base ya tiene la nueva: la sesión sigue.
  let huellaEnBase = "huella-1";
  const r = reloj();
  const revisar = crearRevisor(async () => cuenta({ huella: huellaEnBase }), r.ahora);
  await revisar(cookie());                   // cachea huella-1
  huellaEnBase = "huella-2";
  r.avanzar(1000);                           // dentro del plazo: la caché sigue "fresca"
  assert.deepEqual(await revisar(cookie({ h: "huella-2" })), { vigente: true });
});

test("mayúsculas o espacios en el usuario no esquivan la revisión", async () => {
  let lecturas = 0;
  const revisar = crearRevisor(async () => { lecturas++; return cuenta(); }, reloj().ahora);
  await revisar(cookie({ u: "Angie" }));
  await revisar(cookie({ u: " angie " }));
  assert.equal(lecturas, 1);
});

test("varios pedidos a la vez del mismo usuario comparten UNA lectura del padrón", async () => {
  let lecturas = 0;
  const revisar = crearRevisor(async () => { lecturas++; await new Promise((r) => setTimeout(r, 5)); return cuenta(); }, reloj().ahora);
  const vs = await Promise.all([revisar(cookie()), revisar(cookie()), revisar(cookie()), revisar(cookie())]);
  assert.ok(vs.every((v) => v.vigente));
  assert.equal(lecturas, 1);
});
