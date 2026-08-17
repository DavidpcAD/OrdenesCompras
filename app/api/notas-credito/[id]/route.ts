import { NextResponse } from "next/server";
import { setNotaCreditoEstado } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/notas-credito/{id}  → marca la línea como acreditada ("resuelta") o la
// reabre ("pendiente"). Body: { estado, usuario, rol }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const estado = body.estado === "pendiente" ? "pendiente" : "resuelta";
    const a = await actor({ ...body, rol: body.rol ?? "contabilidad" });
    await setNotaCreditoEstado(Number(params.id), estado, a.usuario, a.rol);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
