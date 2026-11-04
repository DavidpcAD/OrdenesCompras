// Sesión firmada en cookie httpOnly. SIN dependencias nuevas: HMAC-SHA256 con
// Web Crypto (disponible tanto en Node como en el runtime del middleware).
//
// Por qué es seguro: la cookie es `httpOnly` (JavaScript del navegador NO la
// puede leer) y va FIRMADA con SESSION_SECRET (solo el server lo conoce). Nadie
// puede fabricarse un rol desde la consola como sí pasaba con localStorage.
import type { Role } from "./types.ts";

export const SESSION_COOKIE = "adelante_oc_session";
// Cuánto aguanta la sesión SIN USARSE: 30 días. Mientras la persona use la app,
// no vence nunca (se renueva sola, ver middleware.ts).
//
// Historia: primero eran 12 h fijas desde el login (se caía a media jornada); después
// 12 h sin usarla (ago 2026). Eso igual obligaba a entrar de nuevo CADA MAÑANA —la
// pestaña quedaba de un día para otro sin pedir nada— y la gente lo vivía como
// "entrar, salir, entrar, salir" (nov 2026). Una sesión larga solo es segura si se
// puede cortar desde afuera, y eso lo hace lib/sesion-vigente.ts: cambiar la
// contraseña, quitarle el rol o borrar el usuario cierra sus sesiones abiertas en
// minutos, en todos sus equipos.
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 días

// Cuando a la cookie le queda menos de esto, el próximo request la vuelve a firmar
// por otros 30 días. Así se re-firma como mucho UNA vez al día, no en cada request.
export const SESSION_RENEW_AFTER_S = SESSION_MAX_AGE_S - 60 * 60 * 24;

// `h` es la huella de la contraseña con la que se entró (ver huellaDeClave): si la
// clave cambia, la huella deja de calzar y la sesión se cierra. Las cookies firmadas
// antes de nov 2026 no la traen: valen hasta su vencimiento de 12 h y no se renuevan.
export type SessionPayload = { u: string; r: Role; n: string; exp: number; h?: string };

const nowS = () => Math.floor(Date.now() / 1000);

// ¿Hay que exigir sesión? SÍ cuando hay un SESSION_SECRET configurado (así se
// hace en Azure/producción). En local sin secreto queda permisivo para no
// estorbar el desarrollo mock. Se ata al secreto —y NO a USE_API— porque en
// este App Service USE_API no está seteada; atarlo ahí dejaría el candado inerte.
export function authEnabled(): boolean {
  const s = process.env.SESSION_SECRET;
  return !!s && s.length >= 16;
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // Sin secreto (dev/mock): clave fija solo para poder trabajar local. Como
  // authEnabled() es false en ese caso, la sesión no se exige igual.
  return "dev-only-insecure-secret-do-not-use-in-prod";
}

// ---- base64url que funciona en Node y en edge (sin Buffer) ----
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

// Comparación en tiempo constante (evita filtrar la firma por timing).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Opciones de la cookie de sesión, en UN solo lugar: si login, middleware y logout
// no coinciden EXACTAMENTE en path/sameSite/secure, el navegador guarda dos cookies
// distintas y la sesión se "pierde" sin motivo aparente.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}

// ¿Toca renovar? Sí cuando a la sesión le queda menos que SESSION_RENEW_AFTER_S.
// Se exporta aparte (sin cookies ni request) para poder probarlo.
//
// Una cookie sin huella (de antes de nov 2026) NO se renueva: si se renovara, viviría
// para siempre sin que cambiar la contraseña la pudiera cortar. Se deja vencer sola.
export function debeRenovar(payload: SessionPayload, ahoraS: number = nowS()): boolean {
  if (!payload.h) return false;
  return payload.exp - ahoraS < SESSION_RENEW_AFTER_S;
}

// Huella de la contraseña guardada (el HASH de dbo.Usuario, nunca la clave): una firma
// corta con SESSION_SECRET. Viaja dentro de la cookie y se compara cada pocos minutos
// contra la base (lib/sesion-vigente.ts). No sirve para adivinar nada: sin el secreto
// del servidor no se puede ni calcular ni verificar, y es distinta de la de cualquier
// otra app que use el mismo hash.
export async function huellaDeClave(passwordHash: string): Promise<string> {
  return (await hmac(`clave:${passwordHash}`)).slice(0, 22);
}

export async function signSession(u: string, r: Role, n: string, h?: string): Promise<string> {
  const payload: SessionPayload = { u, r, n, exp: nowS() + SESSION_MAX_AGE_S, ...(h ? { h } : {}) };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let expected: string;
  try {
    expected = await hmac(body);
  } catch {
    return null; // sin secreto en prod -> nadie pasa
  }
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (!payload.exp || payload.exp < nowS()) return null;
    return payload;
  } catch {
    return null;
  }
}
