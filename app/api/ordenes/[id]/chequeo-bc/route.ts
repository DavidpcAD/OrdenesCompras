import { NextResponse } from "next/server";
import { chequearOrdenPorId } from "@/lib/chequeo-orden";
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
