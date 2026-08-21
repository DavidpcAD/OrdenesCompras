import { NextResponse } from "next/server";
import { getOrden, setOrdenEstado, updateOrden, ordenTieneRecepciones, MSG_NO_REABRIR } from "@/lib/repo";
import { bcReopenPedido, bcReplaceOrderLines } from "@/lib/bc";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const o = await getOrden(Number(params.id));
    if (!o) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    return NextResponse.json(o);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { estado, motivo, bcNumber, reabrirBc } = body;
    const a = await actor(body);   // identidad de la sesión, no del body
    const id = Number(params.id);

    // REABRIR: la orden vuelve a "Abierto" acá Y el pedido se des-lanza en BC. Si no,
    // en BC queda Lanzado y no se puede editar ni re-sincronizar antes de volver a
    // mandarla a aprobación.
    // - Con recepciones/facturas ya registradas NO se reabre nada (ni acá ni en BC).
    // - Si BC no puede reabrir (p.ej. el web service no está publicado), la orden SÍ
    //   se reabre acá y se devuelve `bcAviso` para que la pantalla lo diga; así el
    //   botón sigue sirviendo y no se pierde el trabajo.
    let bcAviso: string | undefined;
    if (estado === "abierto") {
      if (await ordenTieneRecepciones(id)) {
        return NextResponse.json({ error: MSG_NO_REABRIR }, { status: 409 });
      }
      // Solo el botón "Volver a abrir" (lanzado → abierto) pide des-lanzar en BC.
      // "Cancelar envío" (pendiente → abierto) NO: ahí BC no tiene nada lanzado, y
      // si la orden arrastra un bcNo de un lanzamiento viejo, des-lanzarlo sería un
      // efecto que nadie pidió.
      if (reabrirBc) {
        const no = bcNumber || (await getOrden(id))?.bcNumber;
        if (no) {
          try { await bcReopenPedido(String(no)); }
          catch (e: any) { bcAviso = `Se reabrió acá, pero en BC el pedido ${no} sigue Lanzado — ${String(e?.message ?? e)}`; }
        } else {
          // SIN N.º de BC no hay a quién avisarle: antes se devolvía un `ok` limpio y
          // parecía que todo había funcionado (el pedido en BC seguía Lanzado y nadie
          // se enteraba). Pasa cuando la app no quedó enterada del lanzamiento.
          bcAviso = "Se reabrió acá, pero esta orden no tiene N.º de Business Central guardado, así que no se pudo des-lanzar allá. Buscá el pedido en BC por proveedor y fecha y reabrilo a mano.";
        }
      }
    }

    await setOrdenEstado(id, estado, a.usuario, a.rol, motivo, bcNumber);
    return NextResponse.json({ ok: true, bcAviso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const id = Number(params.id);
    await updateOrden(id, { ...body, ...(await actor(body)) });

    // El edit ya quedó en SQL. Si la orden VIVE EN BC hay que empujarle las líneas
    // nuevas: si no, Bodega recibe y Contabilidad factura contra las viejas (el
    // pedido en BC no se re-sincroniza solo — al re-aprobar, Producción solo lo
    // relanza). Se lee la orden ya guardada para mandar exactamente lo que quedó.
    // Si BC falla NO se revienta el guardado (el SQL ya está): se devuelve el aviso
    // para que la pantalla lo diga y se pueda reintentar volviendo a guardar.
    let bcAviso: string | undefined;
    const o = await getOrden(id);
    if (o?.bcNumber) {
      try {
        const r = await bcReplaceOrderLines(o.bcNumber, o.lineas.map((l) => ({
          tipo: l.tipo === "cargo" ? "cargo" as const : "articulo" as const,
          itemNo: l.articuloId, variantCode: l.variantCode, locationCode: l.almacen,
          unidad: l.unidad,
          cantidad: l.cantidad, precio: l.precioUnitario, descuentoPct: l.descuentoPct,
          jobNo: l.proyecto, taskNo: l.taskNo,
          chargeNo: l.chargeNo, chargeMethod: l.chargeMethod, descripcion: l.descripcion,
        })));
        if (r.omitidas.length) bcAviso = `Guardado. OJO: BC no recibió ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.`;
      } catch (e: any) {
        bcAviso = `Se guardó acá, pero el pedido ${o.bcNumber} en BC quedó con las líneas VIEJAS: ${String(e?.message ?? e)}. Volvé a guardar para reintentar.`;
      }
    }
    return NextResponse.json({ ok: true, bcAviso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
