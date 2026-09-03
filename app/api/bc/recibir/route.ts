import { NextResponse } from "next/server";
import { bcRecibir, diagnosticarFalloBc, verificarLineasPosteables, frenoRegistroActivo, conflictoDeDimensiones, explicarConflictoDimensiones } from "@/lib/bc";
import { frenarPorEncabezado } from "@/lib/freno-encabezado";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Solo recepción en BC (material bien, factura en revisión).
// body: { orderNo, lineas: [{itemNo, qty}], postingDate? }
//
// Mismo diagnóstico que /api/bc/registrar: acá no hay N.º de factura, así que lo
// único que se puede separar es "reintentá" de "BC no tiene el pedido" — pero esa
// sola ya evita mandar a Bodega a reintentar contra una pared.
export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => ({} as any));
  const { orderNo, lineas, postingDate, ordenId, vendorNo } = cuerpo ?? {};
  try {
    // FRENO 1 — el ENCABEZADO del pedido en BC: mismo proveedor y LANZADO allá
    // (ver lib/freno-encabezado.ts). Recibir contra el pedido de otro le mete el
    // material al inventario a nombre equivocado; y contra uno sin lanzar, BC
    // rechaza con un error crudo que Bodega no puede interpretar.
    const frenoProv = await frenarPorEncabezado(orderNo, ordenId, vendorNo, "recibir");
    if (frenoProv) return NextResponse.json(frenoProv, { status: 409 });
    // Mismo freno que en /api/bc/registrar: el codeunit ignora sin avisar la línea
    // que no encuentra en el pedido, y la app la marcaría recibida igual.
    // BC_FRENO_REGISTRO=0 lo apaga desde Azure: si el chequeo diera un falso
    // positivo, Bodega no podría recibir un camión y no se puede esperar un despliegue.
    const freno = frenoRegistroActivo()
      ? await verificarLineasPosteables(String(orderNo ?? ""), lineas ?? [], "recibir")
      : { ok: true, problemas: [] as string[], verificado: false };
    if (!freno.ok) {
      return NextResponse.json({
        ok: false,
        error: `NO se recibió: Business Central no puede recibir ${freno.problemas.length} línea(s).\n\n`
          + freno.problemas.map((p) => `• ${p}`).join("\n")
          + `\n\nCorregí el pedido ${orderNo} en BC (o la orden acá) y volvé a intentar.`,
        frenoLineas: true,
        problemas: freno.problemas,
      }, { status: 409 });
    }
    // Quién recibe, de la cookie firmada (ver lib/actor.ts): queda sellado en el
    // pedido de BC y firma el movimiento de la obra si la factura se registra después.
    const { usuario } = await actor(cuerpo);
    const receiptNo = await bcRecibir(orderNo, lineas ?? [], postingDate ?? "", usuario);
    return NextResponse.json({ ok: true, receiptNo });
  } catch (e: any) {
    const error = String(e?.message ?? e);
    // Choque de DIMENSIONES (el CC que el almacén amarra en BC): no se reintenta y
    // no hay nada que conciliar —BC no registró nada—, así que no se le vuelve a
    // preguntar a BC: se explica y se corta. Ver conflictoDeDimensiones en lib/bc.ts.
    const dim = conflictoDeDimensiones(error);
    if (dim) {
      return NextResponse.json({
        ok: false, error: `NO se recibió: ${explicarConflictoDimensiones(dim, String(orderNo ?? ""))}`,
        frenoDimensiones: true, dimensiones: dim,
      }, { status: 409 });
    }
    const diag = await diagnosticarFalloBc(error, String(orderNo ?? "")).catch(() => null);
    return NextResponse.json({ ok: false, error, ...(diag ?? {}) }, { status: 502 });
  }
}
