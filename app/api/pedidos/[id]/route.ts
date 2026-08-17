import { NextResponse } from "next/server";
import { getPedido, setPedidoEstado, softDeletePedido, updatePedido } from "@/lib/repo";
import { actor } from "@/lib/actor";

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
    const body = await req.json();
    const { estado, motivo } = body;
    const a = await actor(body);   // identidad de la sesión, no del body
    await setPedidoEstado(Number(params.id), estado, a.usuario, a.rol, motivo);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    await updatePedido({ id: Number(params.id), ...body, ...(await actor(body)) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);
    await softDeletePedido(Number(params.id), a.usuario, a.rol);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
