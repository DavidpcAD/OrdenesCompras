import { NextResponse } from "next/server";
import { autenticar } from "@/lib/auth";
import { SESSION_COOKIE, signSession, authEnabled, sessionCookieOptions } from "@/lib/session";
import { demoraPorFallos, esperar, registrarExito, registrarFallo } from "@/lib/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const usuarioIntento = String(body?.username ?? "");
    // Freno anti-fuerza-bruta: los fallos del mismo usuario se van demorando (no se
    // bloquea la cuenta). La demora se aplica ANTES de contestar el 401.
    const demora = demoraPorFallos(usuarioIntento);
    const res = await autenticar(usuarioIntento, String(body?.password ?? ""));
    if (!res.ok) {
      registrarFallo(usuarioIntento);
      await esperar(demora);
      return NextResponse.json({ error: res.error }, { status: 401 });
    }
    registrarExito(usuarioIntento);
    const { role, nombre, username, rolNombre } = res.user;

    const out = NextResponse.json({ role, nombre, username, rolNombre });
    // Solo en modo API (producción): emitimos la cookie de sesión FIRMADA. Si
    // falta SESSION_SECRET, signSession lanza y respondemos 500 con mensaje claro.
    if (authEnabled()) {
      const token = await signSession(username, role, nombre);
      // Mismas opciones que usa el middleware al renovarla (un solo lugar).
      out.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    }
    return out;
  } catch (e: any) {
    // El detalle va al log del server (Azure), NO a la pantalla de login: antes se
    // devolvía tal cual y la página mostraba "Failed to connect to :1433 …", o sea
    // le contaba a cualquiera qué motor y qué puerto hay detrás.
    console.error("login", e);
    return NextResponse.json(
      { error: "No se pudo validar el usuario ahora mismo. Intentá de nuevo; si sigue, avisale a TI." },
      { status: 500 }
    );
  }
}
