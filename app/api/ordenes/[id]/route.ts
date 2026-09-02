import { NextResponse } from "next/server";
import { getOrden, setOrdenEstado, setOrdenBcNumber, updateOrden, descartarOrden, ordenTieneRecepciones, obrasDeLineasPedido, asignarBcNumber, guardarChequeoBc, guardarVariantesResueltas, MSG_NO_REABRIR } from "@/lib/repo";
import { bcReopenPedido, bcReplaceOrderLines, bcCrearPedidoAbierto, crearEnBcAlEnviar, lineasOrdenParaBc, obrasSinTarea, lineasSinUnidad, lineasSinAlmacen, resolverVariantesRequeridas, sanearObrasDeLineas, avisoDeSaneo, bcOrdenTotales, bcEstadoDelPedido, chequearOrdenContraBc, lineasReplaceParaCotejo, lineasOrdenParaCotejo, paredAprobacionActiva, itemsBloqueadosDeLineas } from "@/lib/bc";
import { ordenLineaImporte } from "@/lib/helpers";
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

    // CORREGIR el N.º de Business Central de la orden. Existe porque en BC un pedido
    // no se "corrige": se BORRA y se crea otro. Cuando eso pasa, la orden de la app
    // se queda apuntando a un número que ya no existe y no había forma de moverla —
    // reenviar a aprobación con bcNo puesto solo reescribe las líneas del pedido viejo,
    // y descartar está bloqueado justamente por tener bcNo. La orden quedaba trabada
    // para siempre y Bodega registrando contra una pared. Caso real: CP-005148.
    const nuevoBc = String(body?.corregirBcNumber ?? "").trim().toUpperCase();
    if (nuevoBc) {
      const o = await getOrden(id);
      if (!o) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
      if (nuevoBc === (o.bcNumber ?? "").trim().toUpperCase()) {
        return NextResponse.json({ error: `La orden ya apunta a ${nuevoBc}.` }, { status: 409 });
      }
      // El número nuevo TIENE que existir en BC. Escribir uno que no existe es repetir
      // el problema con otro número: Bodega no se entera hasta que va a registrar.
      const estadoBc = await bcEstadoDelPedido(nuevoBc);
      if (estadoBc === "no-existe") {
        return NextResponse.json({
          error: `Business Central no tiene ningún pedido de compra ${nuevoBc}. Confirmá el número con Proveeduría antes de apuntarle la orden.`,
        }, { status: 409 });
      }
      await setOrdenBcNumber(id, nuevoBc, a.usuario, a.rol, String(body?.motivo ?? "").trim(), o.bcNumber);
      return NextResponse.json({
        ok: true,
        // BC caído no frena la corrección (si no, una orden trabada se queda trabada
        // por un endpoint lento), pero no se puede dar por verificado lo que no se vio.
        bcAviso: estadoBc === "sin-respuesta"
          ? `La orden ya apunta a ${nuevoBc}, pero Business Central no contestó y NO se pudo verificar que ese pedido exista. Confirmalo antes de recibir contra esta orden.`
          : undefined,
      });
    }

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
      // La obra de la solicitud de origen: es el centro de costo de las líneas que van
      // a STOCK. Las de consumo directo ya lo llevan en su propia obra (el Job No.).
      const obrasSolicitud = await obrasDeLineasPedido(
        o.lineas.map((l) => Number(l.pedidoLineaId)).filter((n) => Number.isFinite(n)));
      let lineasBc = lineasOrdenParaBc(o.lineas, obrasSolicitud);
      // ¿La escritura de líneas a BC llegó a entrar? Si no, el cotejo de abajo sobra:
      // el pedido tiene las viejas y ya se sabe por qué.
      let escrituraFallo = false;
      // Obra sin tarea = pedido que NO se va a poder lanzar. BC lo acepta al crearlo
      // y revienta después, en manos del aprobador, así que se corta acá.
      const sinTarea = obrasSinTarea(lineasBc);
      if (sinTarea.length) {
        return NextResponse.json({
          error: `La orden NO se envió a aprobación: ${sinTarea.length} línea(s) tienen obra sin tarea — ${sinTarea.join("; ")}. Business Central no puede lanzar un pedido con obra sin tarea: elegí la tarea (o quitá la obra) y reintentá.`,
        }, { status: 409 });
      }
      // Mismo criterio que la tarea: unidad y variante faltantes NO frenan la
      // creación del pedido en BC, frenan el LANZAMIENTO — o sea que el error le
      // aparece al aprobador, que no tiene cómo arreglarlo. Se corta acá.
      const sinUnidad = lineasSinUnidad(lineasBc);
      if (sinUnidad.length) {
        return NextResponse.json({
          error: `La orden NO se envió a aprobación: ${sinUnidad.length} línea(s) no tienen unidad de compra — ${sinUnidad.join("; ")}. Business Central no puede lanzar un pedido con una línea sin unidad: editá la orden, elegí la unidad y reintentá.`,
        }, { status: 409 });
      }
      // Sin almacén el pedido se crea y se lanza igual, y el material no entra a
      // ningún lado: BC no dice una palabra. Es el error que después obliga a
      // Proveeduría a REHACER el pedido en BC — y rehacerlo es lo que deja huérfana a
      // la orden de la app. Por eso se corta acá, que es donde todavía es gratis.
      const sinAlmacen = lineasSinAlmacen(lineasBc);
      if (sinAlmacen.length) {
        return NextResponse.json({
          error: `La orden NO se envió a aprobación: ${sinAlmacen.length} línea(s) no tienen almacén — ${sinAlmacen.join("; ")}. Sin almacén el material no entra a ningún lado en Business Central (el pedido se lanza igual y el stock nunca sube). Editá la orden, elegí el almacén de recepción y reintentá.`,
        }, { status: 409 });
      }
      // Artículo BLOQUEADO en BC: BC rechaza esa línea al insertarla en el pedido y
      // quien lo crea sigue con las demás. Es la causa verificada de la línea perdida
      // en CP-005172 (M06-0116, bloqueado en BC desde el 14/08 y ordenado el 25/08):
      // el pedido se lanzó con 6 de 7 líneas y ₡22.820 se facturaron de menos.
      // Se corta acá, que es donde todavía no cuesta nada.
      const bloqueados = await itemsBloqueadosDeLineas(lineasBc);
      if (bloqueados.length) {
        return NextResponse.json({
          error: `La orden NO se envió a aprobación: ${bloqueados.length} artículo(s) están BLOQUEADOS en Business Central — ${bloqueados.join("; ")}. `
            + `BC no deja comprarlos: si la orden se manda igual, esa línea se cae del pedido y nadie se entera hasta que llega la factura. `
            + `Sacá esa línea de la orden, o pedile a quien lleva BC que desbloquee el artículo.`,
        }, { status: 409 });
      }

      // Variante: la que se puede deducir (el ítem tiene una sola) se pone acá; la
      // que hay que ELEGIR frena el envío, porque el color o la medida del material
      // no los decide el servidor. Ojo: las pantallas de nueva/editar orden todavía
      // no tienen selector de variante, así que hoy la salida es Compra directa (sí
      // lo tiene) o corregir la solicitud en Ingeniería.
      const varRes = await resolverVariantesRequeridas(lineasBc);
      if (varRes.ambiguas.length) {
        return NextResponse.json({
          error: `La orden NO se envió a aprobación: ${varRes.ambiguas.length} artículo(s) exigen variante y la línea no la trae — ${varRes.ambiguas.join("; ")}. Business Central no puede lanzar un pedido con una línea así.`,
        }, { status: 409 });
      }
      // La variante que se acaba de resolver se GUARDA. `lineasOrdenParaBc` y
      // `decidirVariantes` son map() 1:1 sin filtros, así que el índice i de lineasBc
      // es la línea i de o.lineas — y esa correspondencia es lo único que ata las dos
      // listas (BC no devuelve el id de la línea de la app). Si se rompiera ese 1:1,
      // esto tiene que dejar de hacerse por índice.
      const variantesNuevas = varRes.lineas
        .map((l, i) => ({ idLinea: Number(o.lineas[i]?.id), variantCode: String(l.variantCode ?? "") }))
        .filter((c, i) => c.variantCode && !String(o.lineas[i]?.variantCode ?? "").trim() && Number.isFinite(c.idLinea));
      if (variantesNuevas.length) {
        await guardarVariantesResueltas(id, variantesNuevas).catch(() => { /* no frena el envío */ });
      }
      lineasBc = varRes.lineas;
      if (o.bcNumber) {
        // Reenvío de una orden rechazada/corregida: el pedido ya existe allá. Se le
        // vuelven a empujar las líneas por si un edit no llegó a BC. Que esto falle
        // NO frena el envío (el pedido existe y se puede lanzar): va como aviso.
        try {
          const r = await bcReplaceOrderLines(o.bcNumber, lineasBc);
          if (r.omitidas.length) bcAviso = `Enviada a aprobación. OJO: BC no recibió ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.`;
        } catch (e: any) {
          bcAviso = `Se envió a aprobación, pero el pedido ${o.bcNumber} en BC quedó con las líneas VIEJAS: ${String(e?.message ?? e)}`;
          // Si la reescritura no entró, ya SABEMOS por qué BC va a estar distinto, y el
          // motivo real (típico: "el pedido debe estar Abierto" — hay que reabrirlo en
          // BC) es más útil que el cotejo. Cotejar acá convertiría este aviso deliberado
          // —que a propósito NO frena el envío— en un bloqueo con el mensaje equivocado.
          escrituraFallo = true;
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
          // El N.º se guarda YA, antes de cualquier otra cosa que pueda fallar (el
          // cotejo de acá abajo puede frenar el envío). Si no, el pedido queda creado
          // en BC y la app no sabe su número: al reintentar crea otro y el primero se
          // queda de huérfano — que es justo como aparecen los CP fantasma.
          try { await asignarBcNumber(id, r.number, a.usuario, a.rol); } catch { /* se reintenta al guardar el estado */ }
          const avisos = [
            r.omitidas.length ? `El pedido ${r.number} se creó en BC, pero sin ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.` : "",
            r.avisoCC ?? "",
          ].filter(Boolean);
          if (avisos.length) bcAviso = avisos.join(" · ");
        } catch (e: any) {
          return NextResponse.json({
            error: `La orden NO se envió a aprobación porque no se pudo crear el pedido en Business Central — ${String(e?.message ?? e)}`,
          }, { status: 502 });
        }
      }

      // ── LA PARED ────────────────────────────────────────────────────────────
      // Se relee de BC el pedido que se acaba de crear/reescribir y se cotejan las
      // líneas contra las que se mandaron. Escribir y no volver a mirar es lo que
      // dejó pasar CP-005172 (7 líneas acá, 6 allá, ₡22.820 que el proveedor
      // facturó y BC nunca registró) y a la orden 38.
      //
      // Si no coinciden, la orden NO avanza: mismo criterio que "obra sin tarea" o
      // "línea sin almacén" — se corta donde todavía es gratis, y no cuando el
      // aprobador ya lanzó un pedido que no es el que se le mandó al proveedor.
      // El N.º de BC ya quedó guardado, así que no se pierde nada y se puede
      // reintentar corrigiendo.
      const numeroBc = bcNo || o.bcNumber || "";
      if (numeroBc && !escrituraFallo) {
        const chequeo = await chequearOrdenContraBc(numeroBc, lineasReplaceParaCotejo(lineasBc));
        const detalle = (chequeo.cotejo?.diferencias ?? []).map((d) => `• ${d.texto}`).join("\n");
        // La diferencia de UNIDAD se avisa pero NO frena. Pasa cuando el ítem en BC no
        // tiene registrada la unidad con la que se guardó la línea (una solicitud en UND
        // de un material que en BC solo tiene CUB): el codeunit la ignora a propósito
        // —mejor la unidad del ítem que tumbar el pedido entero— y la línea queda en
        // otra unidad. Desde la app NO hay forma de arreglar eso (la unidad se registra
        // en BC), así que bloquear dejaría la orden sin salida por algo que Proveeduría
        // no puede tocar. Se dice fuerte y se sigue.
        const soloUnidad = !!chequeo.cotejo?.diferencias.length
          && chequeo.cotejo.diferencias.every((d) => d.clase === "unidad");
        if ((chequeo.estado === "desalineado" && !soloUnidad) || chequeo.estado === "sin-pedido") {
          await guardarChequeoBc(id, chequeo.estado, chequeo.mensaje, a.usuario, a.rol).catch(() => { /* el aviso importa más que guardarlo */ });
          // Interruptor de emergencia (App Setting BC_PARED_APROBACION=0): si el cotejo
          // diera un falso positivo en producción, Proveeduría se quedaría sin poder
          // enviar NADA. Apagado, el cotejo igual se hace, se guarda y se avisa: lo
          // único que se pierde es el corte.
          if (paredAprobacionActiva()) {
            return NextResponse.json({
              error: `La orden NO se envió a aprobación: lo que quedó en Business Central NO es lo que dice la orden.\n\n${chequeo.mensaje}\n${detalle}\n\n`
                + `El pedido ${numeroBc} YA quedó creado en Business Central (con esas diferencias) y la orden guardó su número: no se creó nada de más ni hay que borrarlo. `
                + `Corregí la orden acá y volvé a enviarla —se le reescriben las líneas a ese mismo pedido— o arreglá el pedido en BC. `
                + `No se manda a aprobación algo que allá no está igual: así fue como una línea entera se perdió y se facturó de menos.`,
              bcCheck: { estado: chequeo.estado, diferencias: chequeo.cotejo?.diferencias ?? [] },
            }, { status: 409 });
          }
          bcAviso = [bcAviso, `OJO: ${chequeo.mensaje}${detalle ? ` ${detalle}` : ""}`].filter(Boolean).join(" · ");
        } else if (chequeo.estado === "desalineado") {
          // Desalineado que no frena (solo la unidad): se guarda igual y se avisa.
          await guardarChequeoBc(id, "desalineado", chequeo.mensaje, a.usuario, a.rol).catch(() => { /* idem */ });
          bcAviso = [bcAviso, `OJO: ${chequeo.mensaje}${detalle ? ` ${detalle}` : ""} Se envió igual: la unidad de un artículo se registra en Business Central, no acá.`].filter(Boolean).join(" · ");
        } else if (chequeo.estado === "ok") {
          await guardarChequeoBc(id, "ok", chequeo.mensaje, a.usuario, a.rol).catch(() => { /* no bloquea el envío */ });
        } else {
          // "sin-lectura" no frena nada (BC caído no puede trabar a Proveeduría) pero
          // tampoco se guarda como "ok": no se afirma lo que no se pudo ver.
          bcAviso = [bcAviso, `OJO: no se pudo verificar contra Business Central que el pedido ${numeroBc} tenga las mismas líneas que la orden (${chequeo.mensaje}). Verificalo antes de recibir.`].filter(Boolean).join(" · ");
        }
      }
      // El IVA% que se escribe en la orden NO viaja a BC: allá se calcula solo,
      // cruzando el grupo de IVA del PROVEEDOR con el del ARTÍCULO (mirá
      // payloadReplaceLines: en la línea no va ningún campo de IVA). Cuando esos dos
      // no dan lo mismo, el total de la orden "cambia" justo al mandarla a aprobación
      // y desde la pantalla no hay forma de saber por qué.
      //
      // Caso real (1 sep 2026): CP-000134 → CP-005254, una compra de Amazon con IVA 0
      // en la app (correcto: el impuesto de aduana va en su propia línea de cargo) y
      // 13% en BC, porque el proveedor tenía el grupo de IVA doméstico. El 0 era el
      // bueno. Comparar y DECIRLO es lo único que la app puede hacer de su lado: el
      // número que se contabiliza es el de BC.
      if (bcNo) {
        try {
          const bcT = await bcOrdenTotales(bcNo);
          const moneda = (c?: string) => ((c ?? "").trim().toUpperCase() || "CRC");
          if (bcT && moneda(bcT.currencyCode) === moneda(o.currencyCode)) {
            const estimado = o.lineas.reduce(
              (s, l) => s + ordenLineaImporte(l) * (l.tipo === "cargo" ? 1 : 1 + (l.ivaPct || 0) / 100), 0);
            const dif = bcT.total - estimado;
            if (Math.abs(dif) > 0.01) {
              const fmt = (n: number) => n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              bcAviso = [bcAviso, `OJO con el total: BC calculó ${fmt(bcT.total)} (IVA ${fmt(bcT.iva)}) y el estimado de la orden era ${fmt(estimado)} — BC cobra ${fmt(Math.abs(dif))} ${dif > 0 ? "más" : "menos"}. El IVA lo pone BC según el grupo de IVA del proveedor y del artículo, no el IVA% de la orden. Si el de BC no corresponde, hay que corregirlo EN BC (y volver a enviar la orden para que reescriba las líneas).`]
                .filter(Boolean).join(" · ");
            }
          }
        } catch { /* si BC no contesta los totales, el envío no se frena por eso */ }
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
    const a = await actor(body);
    await updateOrden(id, { ...body, ...a });

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
        // Con el centro de costo por línea, editar también tiene que mandarlo: si no,
        // el edit le borraría a BC la obra de las líneas que van a stock.
        const obrasSolicitud = await obrasDeLineasPedido(
          o.lineas.map((l) => Number(l.pedidoLineaId)).filter((n) => Number.isFinite(n)));
        const lineasBc = lineasOrdenParaBc(o.lineas, obrasSolicitud);
        const r = await bcReplaceOrderLines(o.bcNumber, lineasBc);
        if (r.omitidas.length) avisos.push(`Guardado. OJO: BC no recibió ${r.omitidas.length} línea(s) — ${r.omitidas.join("; ")}.`);
        // Se relee BC y se coteja. Acá NO se puede frenar nada (el SQL ya se
        // guardó), pero el resultado deja de ser un toast: queda escrito en la
        // orden y en la bitácora, y la pantalla lo muestra hasta que se arregle.
        const chequeo = await chequearOrdenContraBc(o.bcNumber, lineasReplaceParaCotejo(lineasBc));
        if (chequeo.estado !== "sin-lectura") {
          await guardarChequeoBc(id, chequeo.estado, chequeo.mensaje, a.usuario, a.rol).catch(() => { /* no tumba el guardado */ });
        }
        if (chequeo.estado === "desalineado" || chequeo.estado === "sin-pedido") {
          avisos.push(`${chequeo.mensaje} Business Central quedó DISTINTO de la orden: revisá el aviso rojo del detalle antes de que Bodega reciba.`);
        }
      } catch (e: any) {
        const msg = `Se guardó acá, pero el pedido ${o.bcNumber} en BC quedó con las líneas VIEJAS: ${String(e?.message ?? e)}. Volvé a guardar para reintentar.`;
        avisos.push(msg);
        // El chequeo guardado NO puede seguir diciendo "ok" después de esto: la orden
        // acaba de cambiar acá y en BC no. Si se deja el "ok" viejo, la pantalla se
        // queda muda justo en el caso que hay que gritar.
        await guardarChequeoBc(id, "desalineado", msg, a.usuario, a.rol).catch(() => { /* el aviso ya va en la respuesta */ });
      }
    }
    if (saneo) { const a = avisoDeSaneo(saneo); if (a) avisos.push(a); }
    bcAviso = avisos.join(" · ") || undefined;
    return NextResponse.json({ ok: true, bcAviso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// DESCARTAR un borrador de orden: la orden se elimina (lógico) y el material vuelve
// a quedar pendiente en la solicitud. Solo Abierta/Rechazada y SIN N.º de BC — las
// condiciones las revalida el repo, que es el que sabe.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);
    const r = await descartarOrden(Number(params.id), String(body?.motivo ?? "").trim(), a.usuario, a.rol);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    // Regla de negocio (estado que no corresponde, ya está en BC, tiene recepciones)
    // → 409: la pantalla lo muestra tal cual y no parece que se cayó el servidor.
    const msg = String(e?.message ?? e);
    const negocio = /Business Central|recepciones|Solo se descarta|no encontrada/i.test(msg);
    return NextResponse.json({ error: msg }, { status: negocio ? 409 : 500 });
  }
}
