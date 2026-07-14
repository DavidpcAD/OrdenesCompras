import { NextResponse } from "next/server";
import { updateClasificacion } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Editar una clasificación existente (nombre y/o partida). Mismo XOR que crear.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    const body = await req.json();
    const nombre = String(body?.nombre ?? "").trim();
    const partidaId = body?.partidaId != null ? Number(body.partidaId) : null;
    const subPartidaId = body?.subPartidaId != null ? Number(body.subPartidaId) : null;
    if (!nombre || (!partidaId && !subPartidaId)) {
      return NextResponse.json({ error: "Falta nombre y una partida o sub-partida" }, { status: 400 });
    }
    await updateClasificacion(id, { nombre, partidaId, subPartidaId });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
