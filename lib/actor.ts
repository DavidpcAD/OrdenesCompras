import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, authEnabled } from "./session.ts";
import type { Role } from "./types.ts";

// SEGUNDO CANDADO de /api/*. El middleware ya exige sesión, pero es UNA sola puerta:
// en Next < 14.2.25 bastaba el header `x-middleware-subrequest` para que no corriera
// (CVE-2025-29927) y las rutas contestaban a cualquiera, porque ninguna revisaba la
// cookie por su cuenta. Cada handler de /api lo llama PRIMERO, antes de leer el body
// o tocar SQL/BC; si el middleware vuelve a fallar, la ruta igual se niega.
// lib/segundo-candado.test.ts exige que ningún handler nuevo nazca sin esta línea.
export async function exigirSesion(): Promise<NextResponse | null> {
  if (!authEnabled()) return null;
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (s) return null;
  console.warn(`[seguridad] /api sin sesión pasó el middleware (¿bypass?) · ip=${ipDe()}`);
  return NextResponse.json({ error: "No autenticado." }, { status: 401 });
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
