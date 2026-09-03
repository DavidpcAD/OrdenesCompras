import { NextResponse } from "next/server";
import { devolverLineasDeOrden, getOrden, obrasDeLineasPedido } from "@/lib/repo";
import { bcReplaceOrderLines, bcVaciarLineasPedido, lineasOrdenParaBc, bcDeepLinkPedido } from "@/lib/bc";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEVOLVER AL INGENIERO líneas que ya están dentro de una orden Abierta o Rechazada.
//
// Existe porque la variante / la medida / el grado del material los define QUIEN PIDE,
// no Proveeduría: cuando una orden se rechaza por eso, el material tiene que volver al
// ingeniero. La línea sale de la orden (el saldo vuelve a la solicitud) y queda
// marcada como devuelta, que es lo que la app de Producción ya le muestra a él.
//
// Business Central: el SQL manda. Si la orden vive allá se le empujan las líneas que
// QUEDARON (mismo camino que editar la orden). Si la orden se quedó sin material se
// descarta acá, pero el pedido de BC no se borra desde la app: se dice con nombre y
// link para darlo de baja allá.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { lineaIds, motivo } = body as { lineaIds?: (string | number)[]; motivo?: string };
    if (!Array.isArray(lineaIds) || !lineaIds.length) {
      return NextResponse.json({ error: "Elegí al menos una línea para devolver." }, { status: 400 });
    }
    if (!String(motivo ?? "").trim()) {
      return NextResponse.json({ error: "Escribí el motivo: es lo que el ingeniero va a leer para saber qué corregir." }, { status: 400 });
    }
    const a = await actor(body);   // identidad de la sesión, no del body
    const id = Number(params.id);
    const r = await devolverLineasDeOrden(id, lineaIds.map(Number), String(motivo).trim(), a.usuario, a.rol);

    const avisos: string[] = [];
    if (r.bcNo) {
      if (r.ordenVacia) {
        // La orden se quedó sin material pero NO se descarta: vive en BC, así que
        // conserva su N.º y espera el material corregido. Y el pedido de allá también
        // se VACÍA: si conservara las líneas viejas, cualquiera podría recibirlo o
        // lanzarlo en BC y estaría recibiendo material que esta app ya devolvió al
        // ingeniero. Los dos lados quedan diciendo lo mismo: por ahora, nada.
        const base = `El material volvió al ingeniero. La orden NO se descartó: conserva su N.º ${r.bcNo} y espera la corrección — cuando el ingeniero devuelva el material, agregalo con "+ De solicitudes" al editar esta misma orden y volvé a enviarla a aprobación.`;
        try {
          await bcVaciarLineasPedido(r.bcNo);
          avisos.push(`${base} El pedido ${r.bcNo} en Business Central quedó vacío, esperando esas líneas.`);
        } catch (e: any) {
          // BC no pudo vaciarlo (o el codeunit no acepta la lista vacía): NO se finge
          // que quedó sincronizado. Se dice qué pasó y qué no hay que hacer allá.
          avisos.push(`${base} OJO: no se pudo vaciar el pedido ${r.bcNo} en Business Central (${String(e?.message ?? e)}), así que allá todavía tiene las líneas VIEJAS: no lo recibas ni lo lances hasta que la orden se vuelva a enviar — ${bcDeepLinkPedido(r.bcNo)}`);
        }
      } else if (r.ordenDescartada) {
        // No hay forma de borrar el pedido en BC desde acá (y no debería decidirlo la
        // app): se dice cuál es, para cerrarlo allá y que no quede fantasma.
        avisos.push(`El material volvió al ingeniero y la orden se descartó acá. OJO: en Business Central el pedido ${r.bcNo} sigue existiendo — dalo de baja o cerralo allá: ${bcDeepLinkPedido(r.bcNo)}`);
      } else {
        // Quedaron líneas: hay que re-sincronizar BC o Bodega recibiría contra las
        // viejas (el pedido de BC no se actualiza solo).
        try {
          const o = await getOrden(id);
          if (o) {
            const obras = await obrasDeLineasPedido(
              o.lineas.map((l) => Number(l.pedidoLineaId)).filter((n) => Number.isFinite(n)));
            const rep = await bcReplaceOrderLines(r.bcNo, lineasOrdenParaBc(o.lineas, obras));
            if (rep.omitidas.length) avisos.push(`OJO: BC no recibió ${rep.omitidas.length} línea(s) — ${rep.omitidas.join("; ")}.`);
          }
        } catch (e: any) {
          avisos.push(`Se devolvió acá, pero el pedido ${r.bcNo} en BC quedó con las líneas VIEJAS: ${String(e?.message ?? e)}. Editá y guardá la orden para reintentar.`);
        }
      }
    }
    return NextResponse.json({ ...r, bcAviso: avisos.join(" · ") || undefined });
  } catch (e: any) {
    // Regla de negocio (estado que no corresponde, recepciones, línea manual) → 409:
    // la pantalla lo muestra tal cual y no parece que se cayó el servidor.
    const msg = String(e?.message ?? e);
    const negocio = /Solo se devuelve|recepciones|no es de esta orden|no viene de una solicitud|cargo no se devuelve|ninguna línea|Escribí el motivo|no encontrada|recibido\/facturado|ya no existe/i.test(msg);
    return NextResponse.json({ error: msg }, { status: negocio ? 409 : 500 });
  }
}
