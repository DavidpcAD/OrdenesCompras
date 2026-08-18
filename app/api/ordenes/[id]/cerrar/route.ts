import { NextResponse } from "next/server";
import { cerrarOrden } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/ordenes/[id]/cerrar  { motivo, devolverSaldo }
// Cierra una orden lanzada que ya no va a recibir el resto del material.
// `devolverSaldo` (default true) regresa lo no recibido a las solicitudes de
// origen para que se pueda volver a comprar.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);   // identidad de la sesión, no del body
    const r = await cerrarOrden(Number(params.id), String(body?.motivo ?? ""), a.usuario, a.rol, body?.devolverSaldo !== false);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
