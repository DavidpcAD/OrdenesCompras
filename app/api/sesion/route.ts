import { NextResponse } from "next/server";
import { exigirSesion, sesionActual } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ¿Quién tiene la sesión abierta en este navegador? Lo pregunta la pantalla de entrada
// (app/page.tsx) al abrirse: si la cookie sigue valiendo, la persona pasa directo a su
// módulo en vez de ver el formulario.
//
// Por qué hace falta: la entrada ("/") nunca miraba la cookie. Quien abría la app
// escribiendo la dirección o desde un favorito caía SIEMPRE en el login, aunque tuviera
// la sesión abierta — "entrar, salir, entrar, salir" (nov 2026).
//
// Sin sesión contesta 401 (lo hace el middleware o exigirSesion); en la pantalla de
// entrada un 401 no dispara el aviso de sesión vencida (lib/fetch-guard.ts).
export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  const s = await sesionActual();
  if (!s) return NextResponse.json({ error: "No hay una sesión abierta." }, { status: 401 });
  return NextResponse.json({ role: s.r, nombre: s.n, username: s.u });
}
