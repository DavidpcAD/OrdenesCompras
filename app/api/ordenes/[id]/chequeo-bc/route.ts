import { NextResponse } from "next/server";
import { chequearOrdenPorId } from "@/lib/chequeo-orden";
import { getOrden, guardarChequeoBc } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ordenes/123/chequeo-bc
// ¿Esta orden y Business Central dicen lo mismo, línea por línea?
//
// Se coteja contra DOS cosas distintas según dónde esté la orden:
//   · Pedido VIVO en BC → contra las líneas del pedido (lo que se va a recibir).
//   · Pedido que ya no está (orden completada: BC lo borra cuando se recibe y
//     factura todo) → contra las líneas de las FACTURAS REGISTRADAS. Es el único
//     cotejo posible hacia atrás, y es el que destapa los casos viejos: CP-005172
//     registró 6 de 7 líneas y le faltaron ₡22.820 + IVA.
//
// Es GET porque es una verificación, no una decisión: cualquier rol que pueda ver la
// orden puede pedirla. Guarda el resultado en la orden (columnas opcionales) para que
// el aviso no dependa de que alguien esté mirando la pantalla en ese momento.
// Nunca 500: si BC no contesta, contesta "sin-lectura" — que NO es lo mismo que
// "está mal", y por eso son dos estados distintos.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const a = await actor({}).catch(() => ({ usuario: "sistema", rol: "proveeduria" as const }));
    const r = await chequearOrdenPorId(Number(params.id), { persistir: true, usuario: a.usuario, rol: a.rol });
    if (!r) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    return NextResponse.json(r.resultado);
  } catch (e: any) {
    return NextResponse.json({ estado: "sin-lectura", contra: "nada", mensaje: String(e?.message ?? e), diferencias: [], importeEnJuego: 0 });
  }
}

// POST /api/ordenes/123/chequeo-bc   body: { motivo }
// "Ya lo corregí en Business Central": marca el cotejo como resuelto A MANO.
//
// Hace falta para las órdenes que ya se rompieron. Cuando el pedido en BC ya no
// existe (la orden se completó), la corrección se registra allá como un documento
// APARTE —una factura de compra por la línea que faltó— y ese documento no cuelga
// del pedido: la app no lo puede ver ni atar a la orden. Sin esta salida, esas
// órdenes se quedan en rojo para siempre y el aviso vuelve a ser ruido, que es
// exactamente el problema que este trabajo vino a resolver.
//
// El motivo es OBLIGATORIO y queda en la bitácora: dentro de un mes, "está en verde"
// tiene que poder explicarse con el N.º del documento que lo arregló.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const motivo = String(body?.motivo ?? "").trim();
    if (motivo.length < 5) {
      return NextResponse.json({ error: "Escribí con qué se corrigió en Business Central (por ejemplo, el N.º de la factura que se registró allá)." }, { status: 400 });
    }
    const a = await actor(body);
    const o = await getOrden(Number(params.id));
    if (!o) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    await guardarChequeoBc(
      Number(params.id), "ok",
      `Corregido a mano por ${a.usuario}: ${motivo}`,
      a.usuario, a.rol,
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
