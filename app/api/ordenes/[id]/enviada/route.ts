import { NextResponse } from "next/server";
import { marcarEnvioProveedor } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST   /api/ordenes/[id]/enviada  → marcarla a mano como enviada al proveedor
// DELETE /api/ordenes/[id]/enviada  → quitar la marca (se marcó la fila equivocada)
//
// La marca automática la pone la descarga del PDF. Esta es para lo otro: la orden
// que se mandó por WhatsApp, la que el proveedor pidió de nuevo, la que se imprimió
// del correo. Sin esto el contador de "cuántas faltan" mentiría.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return marcar(req, params.id, false);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return marcar(req, params.id, true);
}

async function marcar(req: Request, id: string, deshacer: boolean) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);   // identidad de la sesión, no del body
    const r = await marcarEnvioProveedor(Number(id), a.usuario, a.rol, { manual: true, deshacer });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
