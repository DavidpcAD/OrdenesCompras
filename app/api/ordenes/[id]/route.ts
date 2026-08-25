import { NextResponse } from "next/server";
import { getOrden, setOrdenEstado, updateOrden, ordenTieneRecepciones, MSG_NO_REABRIR } from "@/lib/repo";
import { bcReopenPedido, bcReplaceOrderLines, bcCrearPedidoAbierto, crearEnBcAlEnviar, lineasOrdenParaBc, obrasSinTarea, sanearObrasDeLineas, avisoDeSaneo } from "@/lib/bc";
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

    // ENVIAR A APROBACIÓN: el Pedido de compra se crea en BC ACÁ y queda ABIERTO.
    // Antes lo creaba la app de Producción al aprobar; ahora ese paso solo LANZA el
    // pedido que ya existe (y así el aprobador ve en BC exactamente lo que aprueba).
    let bcNo: string | undefined = bcNumber;
    if (estado === "pendiente_aprobacion" && crearEnBcAlEnviar()) {
      const o = await getOrden(id);
      if (!o) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
      const lineasBc = lineasOrdenParaBc(o.lineas);
      // Obra sin tarea = pedido que NO se va a poder lanzar. BC lo acepta al crearlo
      // y revienta después, en manos del aprobador, así que se corta acá.
      const sinTarea = obrasSinTarea(lineasBc);
      if (sinTarea.length) {
        return NextResponse.json({
          error: `La orden NO se envió a aprobación: ${sinTarea.length} línea(s) tienen obra sin tarea — ${sinTarea.join("; ")}. Business Central no puede lanzar un pedido con obra sin tarea: elegí la tarea (o quitá la obra) y reintentá.`,
        }, { status: 409 });
      }
      if (o.bcNumber) {
        // Reenvío de una orden rechazada/corregida: el pedido ya existe allá. Se le
        // vuelven a empujar las líneas por si un edit no llegó a BC. Que esto falle
        // NO frena el envío (el pedido existe y se puede lanzar): va como aviso.
        try {
          const r = await bcReplaceOrderLines(o.bcNumber, lineasBc);
          if (r.omitidas.length) bcAviso = `Enviada a aprobación. OJO: BC no recibió ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.`;
        } catch (e: any) {
          bcAviso = `Se envió a aprobación, pero el pedido ${o.bcNumber} en BC quedó con las líneas VIEJAS: ${String(e?.message ?? e)}`;
        }
      } else {
        // Sin pedido en BC no hay nada que aprobar: si la creación falla, la orden se
        // queda como está y se dice por qué. Mandarla igual dejaría al aprobador con
        // un botón de lanzar que no tiene qué lanzar.
        try {
          const r = await bcCrearPedidoAbierto({
            vendorNo: o.proveedorNo || o.proveedorId,
            currencyCode: o.currencyCode,
            lineas: lineasBc,
          });
          bcNo = r.number;
          if (r.omitidas.length) bcAviso = `El pedido ${r.number} se creó en BC, pero sin ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.`;
        } catch (e: any) {
          return NextResponse.json({
            error: `La orden NO se envió a aprobación porque no se pudo crear el pedido en Business Central — ${String(e?.message ?? e)}`,
          }, { status: 502 });
        }
      }
    }

    await setOrdenEstado(id, estado, a.usuario, a.rol, motivo, bcNo);
    return NextResponse.json({ ok: true, bcAviso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const id = Number(params.id);
    // La obra de una línea es un Project No. de BC. Como se venía llenando con el
    // almacén/centro de costo de la solicitud, podía traer un código que en BC NO es
    // obra (ALM-GRAL, centros de costo sin proyecto) y entonces BC rechaza la
    // reescritura ENTERA del pedido: el edit quedaba acá y allá con las líneas
    // viejas, sin forma de reintentar. Se limpia ANTES de guardar para que el código
    // malo tampoco se quede en el SQL (así una orden ya guardada así se cura sola al
    // volver a guardarla).
    const saneo = Array.isArray(body?.lineas) ? await sanearObrasDeLineas(body.lineas) : null;
    if (saneo) body.lineas = saneo.lineas;
    await updateOrden(id, { ...body, ...(await actor(body)) });

    // El edit ya quedó en SQL. Si la orden VIVE EN BC hay que empujarle las líneas
    // nuevas: si no, Bodega recibe y Contabilidad factura contra las viejas (el
    // pedido en BC no se re-sincroniza solo — al re-aprobar, Producción solo lo
    // relanza). Se lee la orden ya guardada para mandar exactamente lo que quedó.
    // Si BC falla NO se revienta el guardado (el SQL ya está): se devuelve el aviso
    // para que la pantalla lo diga y se pueda reintentar volviendo a guardar.
    // Lo que hizo el saneo NO puede quedar mudo: quitarle la obra a una línea cambia
    // a qué se costea el material, y no haber podido verificarla explica de antemano
    // el rechazo de BC que si no llega pelado ("volvé a guardar" a ciegas).
    const avisos: string[] = [];
    let bcAviso: string | undefined;
    const o = await getOrden(id);
    if (o?.bcNumber) {
      try {
        const r = await bcReplaceOrderLines(o.bcNumber, lineasOrdenParaBc(o.lineas));
        if (r.omitidas.length) avisos.push(`Guardado. OJO: BC no recibió ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.`);
      } catch (e: any) {
        avisos.push(`Se guardó acá, pero el pedido ${o.bcNumber} en BC quedó con las líneas VIEJAS: ${String(e?.message ?? e)}. Volvé a guardar para reintentar.`);
      }
    }
    if (saneo) { const a = avisoDeSaneo(saneo); if (a) avisos.push(a); }
    bcAviso = avisos.join(" · ") || undefined;
    return NextResponse.json({ ok: true, bcAviso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
