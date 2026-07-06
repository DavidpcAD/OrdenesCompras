import { NextResponse } from "next/server";
import { listVistas, saveVista } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vistas de tabla guardadas por usuario. GET ?usuario=&tabla=
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const usuario = u.searchParams.get("usuario") ?? "";
    const tabla = u.searchParams.get("tabla") ?? "";
    if (!usuario || !tabla) return NextResponse.json({ vistas: [] });
    return NextResponse.json({ vistas: await listVistas(usuario, tabla) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b?.usuario || !b?.tabla || !b?.nombre) return NextResponse.json({ error: "Faltan usuario, tabla o nombre" }, { status: 400 });
    const id = await saveVista({ usuario: String(b.usuario), tablaKey: String(b.tabla), nombre: String(b.nombre), config: b.config ?? {}, esPredeterminada: !!b.esPredeterminada });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
