import { NextResponse } from "next/server";
import { getPedido, setPedidoEstado, softDeletePedido } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const p = await getPedido(Number(params.id));
    if (!p) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
    return NextResponse.json(p);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { estado, usuario, rol } = await req.json();
    await setPedidoEstado(Number(params.id), estado, usuario, rol);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const { usuario, rol } = await req.json().catch(() => ({ usuario: "Sistema", rol: "ingenieria" }));
    await softDeletePedido(Number(params.id), usuario ?? "Sistema", rol ?? "ingenieria");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
