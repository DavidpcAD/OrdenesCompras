import { NextResponse } from "next/server";
import { createPedido, listPedidos } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listPedidos());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // usuario/rol de la SESIÓN, no del body (el body es falsificable).
    const id = await createPedido({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idPedidoCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
