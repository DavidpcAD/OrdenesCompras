// La cookie de sesión es lo único que separa a la app de internet: si la firma se
// puede falsificar o un token vencido pasa, cualquiera entra con el rol que quiera.
// Estas pruebas fijan ese contrato. Corren con `npm test`.
process.env.SESSION_SECRET = "secreto-de-prueba-largo-para-hmac";

import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, authEnabled, SESSION_MAX_AGE_S, SESSION_RENEW_AFTER_S, debeRenovar, sessionCookieOptions, huellaDeClave } from "./session.ts";

test("con SESSION_SECRET configurado la autenticación queda exigida", () => {
  assert.equal(authEnabled(), true);
});

test("un token propio se verifica y devuelve usuario, rol y nombre", async () => {
  const t = await signSession("angie", "proveeduria", "Angie");
  const p = await verifySession(t);
  assert.ok(p);
  assert.equal(p!.u, "angie");
  assert.equal(p!.r, "proveeduria");
  assert.equal(p!.n, "Angie");
  // Expira dentro de la ventana esperada (30 días), no "nunca".
  const restante = p!.exp - Math.floor(Date.now() / 1000);
  assert.ok(restante > SESSION_MAX_AGE_S - 60 && restante <= SESSION_MAX_AGE_S);
});

test("cambiar el payload invalida la firma (no se puede auto-ascender de rol)", async () => {
  const t = await signSession("pedro", "facturacion", "Pedro");
  const [body, sig] = t.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  payload.r = "proveeduria";                       // el atacante se cambia el rol
  const falso = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig;
  assert.equal(await verifySession(falso), null);
});

test("una firma cualquiera no pasa", async () => {
  const t = await signSession("pedro", "facturacion", "Pedro");
  const [body] = t.split(".");
  assert.equal(await verifySession(`${body}.firmainventada`), null);
});

test("un token vencido no pasa", async () => {
  // Se arma a mano un payload ya expirado y se firma con el mismo secreto: la
  // firma es válida, lo que debe rechazarlo es el `exp`.
  const { createHmac } = await import("node:crypto");
  const payload = { u: "angie", r: "proveeduria", n: "Angie", exp: Math.floor(Date.now() / 1000) - 10 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(body).digest("base64url");
  assert.equal(await verifySession(`${body}.${sig}`), null);
});

test("basura, vacío o sin punto no pasan", async () => {
  assert.equal(await verifySession(undefined), null);
  assert.equal(await verifySession(""), null);
  assert.equal(await verifySession("sinpunto"), null);
  assert.equal(await verifySession("a.b.c"), null);
});

// ---------------------------------------------------------------------------
// Renovación deslizante. Es lo que evita que a alguien se le caiga la sesión en
// plena jornada: mientras use la app, la cookie se vuelve a firmar. Si esto se
// rompe, vuelve el 401 "No autenticado" con la pantalla abierta.
// ---------------------------------------------------------------------------
const ahora = Math.floor(Date.now() / 1000);
const sesion = (expEnSegundos: number) => ({ u: "angie", r: "proveeduria" as const, n: "Angie", exp: ahora + expEnSegundos, h: "huella" });

test("una sesión recién firmada NO se renueva (no se re-firma en cada request)", () => {
  assert.equal(debeRenovar(sesion(SESSION_MAX_AGE_S), ahora), false);
});

test("cuando le queda menos del umbral, se renueva", () => {
  assert.equal(debeRenovar(sesion(SESSION_RENEW_AFTER_S - 60), ahora), true);
});

test("justo en el umbral todavía no se renueva; un segundo después sí", () => {
  assert.equal(debeRenovar(sesion(SESSION_RENEW_AFTER_S), ahora), false);
  assert.equal(debeRenovar(sesion(SESSION_RENEW_AFTER_S - 1), ahora), true);
});

test("una sesión ya vencida cae en renovar (verifySession la rechaza antes)", () => {
  assert.equal(debeRenovar(sesion(-10), ahora), true);
});

test("renovar da otros 30 días completos desde ahora", async () => {
  const t = await signSession("angie", "proveeduria", "Angie", "huella");
  const p = await verifySession(t);
  assert.ok(p);
  assert.ok(p!.exp - ahora >= SESSION_MAX_AGE_S - 5);
  assert.equal(debeRenovar(p!, ahora), false);
});

test("la cookie de sesión es httpOnly, secure, sameSite lax y de todo el sitio", () => {
  // Si login, middleware y logout no coinciden en estas opciones, el navegador
  // guarda cookies distintas y la sesión se "pierde" sin explicación.
  const o = sessionCookieOptions();
  assert.equal(o.httpOnly, true);
  assert.equal(o.secure, true);
  assert.equal(o.sameSite, "lax");
  assert.equal(o.path, "/");
  assert.equal(o.maxAge, SESSION_MAX_AGE_S);
});

// ---------------------------------------------------------------------------
// Sesión larga (nov 2026). La gente tenía que entrar todas las mañanas: la cookie
// vencía tras 12 h sin uso y la pestaña pasaba la noche sin pedir nada. Ahora dura
// 30 días sin uso, y lo que la hace segura es la huella de la clave (ver
// lib/sesion-vigente.ts).
// ---------------------------------------------------------------------------
test("la sesión aguanta 30 días sin usarse, y no más", () => {
  assert.equal(SESSION_MAX_AGE_S, 30 * 24 * 60 * 60);
});

test("de un día para otro sin tocar la app, la sesión sigue viva", async () => {
  const t = await signSession("angie", "proveeduria", "Angie", "huella");
  const p = await verifySession(t);
  assert.ok(p);
  // 5 p.m. → 7 a.m. del lunes siguiente: un fin de semana largo entero.
  const lunes = ahora + 3 * 24 * 60 * 60 + 14 * 60 * 60;
  assert.ok(p!.exp > lunes, "la sesión tiene que llegar viva al lunes");
});

test("se re-firma como mucho una vez al día, no en cada request", () => {
  const unaHora = 60 * 60;
  assert.equal(debeRenovar(sesion(SESSION_MAX_AGE_S - unaHora), ahora), false, "a la hora de entrar no se re-firma");
  assert.equal(debeRenovar(sesion(SESSION_MAX_AGE_S - 25 * unaHora), ahora), true, "al día siguiente sí");
});

test("una cookie vieja sin huella NO se renueva: vence sola en sus 12 h", () => {
  const vieja = { u: "angie", r: "proveeduria" as const, n: "Angie", exp: ahora + 60 };
  assert.equal(debeRenovar(vieja, ahora), false);
});

test("la huella viaja dentro de la cookie firmada y no se puede cambiar", async () => {
  const h = await huellaDeClave("$2a$10$hashDeEjemplo");
  const t = await signSession("pedro", "facturacion", "Pedro", h);
  const p = await verifySession(t);
  assert.equal(p!.h, h);
  const [body, sig] = t.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  payload.h = "otra";
  assert.equal(await verifySession(Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig), null);
});

test("la huella cambia si cambia el hash de la clave, y no lo deja ver", async () => {
  const a = await huellaDeClave("$2a$10$hashUno");
  const b = await huellaDeClave("$2a$10$hashDos");
  assert.notEqual(a, b);
  assert.equal(a, await huellaDeClave("$2a$10$hashUno"), "la misma clave da la misma huella");
  assert.ok(!a.includes("hashUno"));
  assert.equal(a.length, 22);
});
