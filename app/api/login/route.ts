import { NextResponse } from "next/server";
import { autenticar } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, signSession, authEnabled } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const res = await autenticar(String(body?.username ?? ""), String(body?.password ?? ""));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
    const { role, nombre, username, rolNombre } = res.user;

    const out = NextResponse.json({ role, nombre, username, rolNombre });
    // Solo en modo API (producción): emitimos la cookie de sesión FIRMADA. Si
    // falta SESSION_SECRET, signSession lanza y respondemos 500 con mensaje claro.
    if (authEnabled()) {
      const token = await signSession(username, role, nombre);
      out.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_S,
      });
    }
    return out;
  } catch (e: any) {
    return NextResponse.json({ error: `No se pudo validar: ${String(e?.message ?? e)}` }, { status: 500 });
  }
}
