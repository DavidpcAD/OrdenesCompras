import { NextResponse } from "next/server";
import { devolverLineasPedido } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Devolver al ingeniero LÍNEAS sueltas de una solicitud (o todas). El pedido entero
// solo se marca "Devuelto" si no le queda ninguna línea viva; ver devolverLineasPedido.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { lineaIds, motivo } = body as { lineaIds?: (string | number)[]; motivo?: string };
    if (!Array.isArray(lineaIds) || !lineaIds.length) {
      return NextResponse.json({ error: "Elegí al menos una línea para devolver." }, { status: 400 });
    }
    if (!String(motivo ?? "").trim()) {
      return NextResponse.json({ error: "Escribí el motivo de la devolución." }, { status: 400 });
    }
    const a = await actor(body);   // identidad de la sesión, no del body
    const r = await devolverLineasPedido(
      Number(params.id), lineaIds.map(Number), String(motivo).trim(), a.usuario, a.rol,
    );
    return NextResponse.json(r);
  } catch (e: any) {
    // Regla de negocio (línea ya ordenada / línea de otro pedido) → 409, no 500:
    // la pantalla lo muestra tal cual y no parece que se cayó el servidor.
    const msg = String(e?.message ?? e);
    const negocio = /orden de compra|no es de esta solicitud|no existe|ninguna línea/i.test(msg);
    return NextResponse.json({ error: msg }, { status: negocio ? 409 : 500 });
  }
}
