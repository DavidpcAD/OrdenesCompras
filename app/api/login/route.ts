import { NextResponse } from "next/server";
import { autenticar } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const res = await autenticar(String(body?.username ?? ""), String(body?.password ?? ""));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
    const { role, nombre, username, rolNombre } = res.user;
    return NextResponse.json({ role, nombre, username, rolNombre });
  } catch (e: any) {
    return NextResponse.json({ error: `No se pudo validar: ${String(e?.message ?? e)}` }, { status: 500 });
  }
}
