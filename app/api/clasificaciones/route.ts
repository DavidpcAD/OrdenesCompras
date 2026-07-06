import { NextResponse } from "next/server";
import { listWbs, createClasificacion } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Árbol del maestro: etapa -> partida -> sub_partida + clasificaciones del ingeniero.
export async function GET() {
  try {
    return NextResponse.json(await listWbs());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// Crear una clasificación (control del ingeniero) colgando de una partida O sub_partida.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const nombre = String(body?.nombre ?? "").trim();
    const partidaId = body?.partidaId != null ? Number(body.partidaId) : null;
    const subPartidaId = body?.subPartidaId != null ? Number(body.subPartidaId) : null;
    if (!nombre || (!partidaId && !subPartidaId)) {
      return NextResponse.json({ error: "Falta nombre y una partida o sub-partida" }, { status: 400 });
    }
    const id = await createClasificacion({ nombre, partidaId, subPartidaId });
    return NextResponse.json({ idClasificacion: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
