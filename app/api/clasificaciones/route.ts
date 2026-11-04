import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { listWbs, createClasificacion } from "@/lib/repo";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Árbol del maestro: etapa -> partida -> sub_partida + clasificaciones del ingeniero.
export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json(await listWbs());
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}

// Crear una clasificación (control del ingeniero) colgando de una partida O sub_partida.
export async function POST(req: Request) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
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
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
