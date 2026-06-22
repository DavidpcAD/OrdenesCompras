import { NextResponse } from "next/server";
import { bcCrearPedido, bcDeepLinkPedido } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea un Pedido de compra (Purchase Order) en Business Central a partir del
// proveedor y las líneas de material seleccionadas en Proveeduría.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { number, id } = await bcCrearPedido(body);
    return NextResponse.json({ number, id, deepLink: bcDeepLinkPedido(number) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
