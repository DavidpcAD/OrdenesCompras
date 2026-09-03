import { NextResponse } from "next/server";
import { bcFacturarRecibido, verificarLineasPosteables, frenoRegistroActivo, conflictoDeDimensiones, explicarConflictoDimensiones } from "@/lib/bc";
import { frenarPorEncabezado } from "@/lib/freno-encabezado";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Registrar la factura de lo YA recibido (Kattya, tras revisar).
// body: { orderNo, vendorInvoiceNo, lineas: [{itemNo, qty}] }
export async function POST(req: Request) {
  // El body se lee FUERA del try porque el catch necesita el `orderNo` para poder
  // decir de qué pedido habla el error (adentro quedaba fuera de alcance).
  const cuerpo = await req.json().catch(() => ({} as any));
  const { orderNo, vendorInvoiceNo, lineas, ordenId, vendorNo } = cuerpo ?? {};
  try {
    // FRENO 1 — el ENCABEZADO del pedido en BC: mismo proveedor y LANZADO allá
    // (ver lib/freno-encabezado.ts). Acá es lo último que queda antes de que la
    // cuenta por pagar se mueva: si algo del encabezado no calza, no se factura.
    const frenoProv = await frenarPorEncabezado(orderNo, ordenId, vendorNo, "facturar");
    if (frenoProv) return NextResponse.json(frenoProv, { status: 409 });
    // Acá el saldo que importa es lo RECIBIDO SIN FACTURAR: el codeunit filtra por
    // "Qty. Rcd. Not Invoiced" y, si no calza, se salta la línea sin decir nada.
    // BC_FRENO_REGISTRO=0 lo apaga desde Azure: si el chequeo diera un falso
    // positivo, Bodega no podría recibir un camión y no se puede esperar un despliegue.
    const freno = frenoRegistroActivo()
      ? await verificarLineasPosteables(String(orderNo ?? ""), lineas ?? [], "facturar-recibido")
      : { ok: true, problemas: [] as string[], verificado: false };
    if (!freno.ok) {
      return NextResponse.json({
        ok: false,
        error: `NO se facturó: Business Central no puede facturar ${freno.problemas.length} línea(s).\n\n`
          + freno.problemas.map((p) => `• ${p}`).join("\n")
          + `\n\nRevisá el pedido ${orderNo} en BC antes de reintentar.`,
        frenoLineas: true,
        problemas: freno.problemas,
      }, { status: 409 });
    }
    // Quién factura, de la cookie firmada (ver lib/actor.ts): sobrescribe en el pedido
    // el nombre que dejó la recepción, porque es este registro el que crea el consumo.
    const { usuario } = await actor(cuerpo);
    const postedNo = await bcFacturarRecibido(orderNo, vendorInvoiceNo, lineas ?? [], "", usuario);
    return NextResponse.json({ ok: true, postedNo });
  } catch (e: any) {
    const error = String(e?.message ?? e);
    // Choque de DIMENSIONES (el CC que el almacén amarra en BC): no se reintenta —
    // cada intento da el mismo error— y BC no registró nada. Se explica y se corta.
    // Ver conflictoDeDimensiones en lib/bc.ts.
    const dim = conflictoDeDimensiones(error);
    if (dim) {
      return NextResponse.json({
        ok: false, error: `NO se facturó: ${explicarConflictoDimensiones(dim, String(orderNo ?? ""))}`,
        frenoDimensiones: true, dimensiones: dim,
      }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }
}
