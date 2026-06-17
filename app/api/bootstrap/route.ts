import { NextResponse } from "next/server";
import { listMovimientosAll, listOrdenes, listPedidos, listRecepciones } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Carga inicial de toda la data para el front-end (modo API).
export async function GET() {
  try {
    const [pedidos, ordenes, recepciones, movimientos] = await Promise.all([
      listPedidos(), listOrdenes(), listRecepciones(), listMovimientosAll(),
    ]);
    return NextResponse.json({ pedidos, ordenes, recepciones, movimientos });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
