import { NextResponse } from "next/server";
import { bcCrearYLanzarPedido, bcDeepLinkPedido } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea el Pedido de compra en Business Central a partir de las líneas aprobadas
// y lo LANZA (Release) en el mismo paso, para que en BC aparezca directo como
// "Lanzado". Lo usa Aprobación cuando Luis Roberto aprueba la orden.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { number, id, omitidas, released, releaseError } = await bcCrearYLanzarPedido(body);
    return NextResponse.json(
      { number, id, omitidas, released, releaseError, deepLink: bcDeepLinkPedido(number) },
      { status: 201 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
