import { NextResponse } from "next/server";
import { nuevaOrdenDesdePendiente } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/ordenes/[id]/nueva-con-pendiente  { motivo }
// Cierra la orden y crea una nueva (abierta) con el material que quedó sin recibir.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);
    const r = await nuevaOrdenDesdePendiente(Number(params.id), String(body?.motivo ?? ""), a.usuario, a.rol);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
