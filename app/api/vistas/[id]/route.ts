import { NextResponse } from "next/server";
import { deleteVista } from "@/lib/repo";
import { mensajeParaPantalla } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const usuario = new URL(req.url).searchParams.get("usuario") ?? "";
    await deleteVista(Number(params.id), usuario);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vistas DELETE", e);
    return NextResponse.json({ error: mensajeParaPantalla(e, "No se pudo borrar la vista") }, { status: 500 });
  }
}
