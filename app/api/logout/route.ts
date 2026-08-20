import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cierra la sesión borrando la cookie firmada.
export async function POST() {
  const out = NextResponse.json({ ok: true });
  // maxAge 0 = borrar. El resto DEBE coincidir con cómo se creó o el navegador
  // borra "otra" cookie y deja la de verdad viva.
  out.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return out;
}
