import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, authEnabled, sessionCookieOptions, type SessionPayload } from "./session.ts";
import { crearRevisor } from "./sesion-vigente.ts";
import type { Role } from "./types.ts";

// Revisa cada pocos minutos que la cuenta de la cookie siga igual en el padrón
// (lib/sesion-vigente.ts). El padrón se importa recién al usarlo: lib/auth.ts arrastra
// mssql y bcrypt, y este módulo lo cargan las 87 rutas.
const revisarCuenta = crearRevisor(async (u) => (await import("./auth.ts")).estadoDeCuenta(u));

// SEGUNDO CANDADO de /api/*. El middleware ya exige sesión, pero es UNA sola puerta:
// en Next < 14.2.25 bastaba el header `x-middleware-subrequest` para que no corriera
// (CVE-2025-29927) y las rutas contestaban a cualquiera, porque ninguna revisaba la
// cookie por su cuenta. Cada handler de /api lo llama PRIMERO, antes de leer el body
// o tocar SQL/BC; si el middleware vuelve a fallar, la ruta igual se niega.
// lib/segundo-candado.test.ts exige que ningún handler nuevo nazca sin esta línea.
//
// Además corta la sesión si la cuenta cambió desde que se abrió (contraseña, rol, o el
// usuario ya no existe). El middleware no lo puede hacer: corre en el runtime "edge",
// sin acceso a SQL. Por eso vive acá, que es por donde pasa todo pedido de datos.
export async function exigirSesion(): Promise<NextResponse | null> {
  if (!authEnabled()) return null;
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!s) {
    console.warn(`[seguridad] /api sin sesión pasó el middleware (¿bypass?) · ip=${ipDe()}`);
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  const v = await revisarCuenta(s);
  if (v.vigente) return null;
  console.warn(`[seguridad] sesión cerrada porque cambió la cuenta · usuario=${s.u} · ${v.motivo} · ip=${ipDe()}`);
  const res = NextResponse.json({ error: v.mensaje, motivo: v.motivo }, { status: 401 });
  // Se borra la cookie con las MISMAS opciones con que se creó (si no, borra "otra").
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

// Quién tiene la sesión abierta, para la pantalla de entrada (app/api/sesion). Se
// llama DESPUÉS de exigirSesion, que ya hizo la revisión de la cuenta.
export async function sesionActual(): Promise<SessionPayload | null> {
  return verifySession(cookies().get(SESSION_COOKIE)?.value);
}

function ipDe(): string {
  try {
    return (headers().get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  } catch {
    return "?";
  }
}

// Quién está haciendo la acción, según la COOKIE FIRMADA — no según el body.
//
// Las rutas de escritura recibían `usuario` y `rol` en el JSON y los guardaban tal
// cual en dbo.Movimiento y en creadoPor/modificadoPor. Eso es falsificable con un
// `curl`: cualquiera con sesión podía dejar una devolución o una recepción firmada
// con el nombre de otra persona. Para todo lo que queda en la bitácora manda la
// sesión; el body solo se usa en local/mock, donde authEnabled() es false y no hay
// a quién creerle. Con la sesión encendida y sin cookie válida NO se le cree al
// body: se corta (antes caía al body y se podía firmar a nombre de cualquiera).
export async function actor(body?: { usuario?: unknown; rol?: unknown }): Promise<{ usuario: string; rol: Role }> {
  if (!authEnabled()) {
    return {
      usuario: String(body?.usuario ?? "").trim() || "Sistema",
      rol: (typeof body?.rol === "string" ? body.rol : "proveeduria") as Role,
    };
  }
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!s) throw new Error("No autenticado: la sesión venció o no es válida. Volvé a iniciar sesión.");
  return { usuario: s.n || s.u, rol: s.r };
}
