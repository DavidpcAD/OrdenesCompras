import { NextResponse } from "next/server";
import { getOrden, setOrdenEstado, updateOrden } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const o = await getOrden(Number(params.id));
    if (!o) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    return NextResponse.json(o);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { estado, motivo, bcNumber } = body;
    const a = await actor(body);   // identidad de la sesión, no del body
    await setOrdenEstado(Number(params.id), estado, a.usuario, a.rol, motivo, bcNumber);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    await updateOrden(Number(params.id), { ...body, ...(await actor(body)) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
