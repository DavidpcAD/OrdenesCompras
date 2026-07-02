import { NextResponse } from "next/server";
import { deletePlantilla, updatePlantilla } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body?.nombre) return NextResponse.json({ error: "Falta nombre" }, { status: 400 });
    await updatePlantilla(Number(params.id), {
      nombre: String(body.nombre),
      idSubPartida: body.idSubPartida != null ? Number(body.idSubPartida) : null,
      lineas: Array.isArray(body.lineas) ? body.lineas : [],
      usuario: String(body.usuario ?? ""),
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const usuario = new URL(req.url).searchParams.get("usuario") ?? "";
    await deletePlantilla(Number(params.id), usuario);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
