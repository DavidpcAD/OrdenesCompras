import { NextResponse } from "next/server";
import { listWbs, createSubPartida } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Árbol del maestro: etapa -> partida -> sub_partida (clasificación).
export async function GET() {
  try {
    return NextResponse.json(await listWbs());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// Crear una clasificación = una sub_partida bajo una partida (código autogenerado).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const partidaId = Number(body?.partidaId);
    const nombre = String(body?.nombre ?? "").trim();
    if (!partidaId || !nombre) {
      return NextResponse.json({ error: "Faltan partidaId o nombre" }, { status: 400 });
    }
    const id = await createSubPartida({ partidaId, nombre });
    return NextResponse.json({ idSubPartida: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
