import { NextResponse } from "next/server";
import { corregirPreciosOrden, getOrden, setOrdenEstado } from "@/lib/repo";
import { bcActualizarPreciosPedido, bcLineasPedido, bcOrdenTotales, bcReleasePedidoVerificado } from "@/lib/bc";
import { actor, exigirSesion } from "@/lib/actor";
import { aprobacionAutomatica, aprobacionAutomaticaActiva, MOV_APROBACION_AUTOMATICA, USUARIO_APROBACION_AUTOMATICA } from "@/lib/aprobacion-automatica";
import { detalleCorreccion, emparejarConBc, ordenConPrecios, validarCorreccionPrecio, type CambioPrecio } from "@/lib/corregir-precio";
import { ordenTotalConIva } from "@/lib/helpers";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORREGIR EL PRECIO de una orden que ya tiene material recibido (ver
// lib/corregir-precio.ts). body: { lineas: [{ ordenLineaId, precio }], motivo }
//
// El orden importa, y es el de siempre en esta app: BC primero, la base después.
//   1. Se valida contra la orden recién leída y se aparea cada línea con SU línea del
//      pedido en BC (por N.º de línea, con el precio que se leyó allá).
//   2. BC cambia los precios (AdelantePO_UpdateLinePrices): todo o nada, y deja el
//      pedido Abierto.
//   3. Se decide cómo vuelve a quedar: si la orden no necesita aprobación (las mismas
//      reglas de siempre, con el total NUEVO), se relanza en BC acá mismo; si no, pasa
//      a "Pendiente de aprobación" y la aprueba Aprobación.
//   4. La base: precio en su lugar, totales de lo que sigue en revisión y bitácora.
// Si la base falla en el paso 4, BC ya quedó bien y reintentar sirve: el apareo ve en
// BC el precio nuevo, el codeunit lo vuelve a poner (no cambia nada) y la base lo toma.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  const body = await req.json().catch(() => ({} as any));
  const id = Number(params.id);
  try {
    const a = await actor(body);
    const orden = await getOrden(id);
    if (!orden) return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
    const motivo = String(body?.motivo ?? "").trim();
    const pedidos: CambioPrecio[] = Array.isArray(body?.lineas)
      ? body.lineas.map((l: any) => ({ ordenLineaId: String(l?.ordenLineaId ?? ""), precio: Number(l?.precio) }))
      : [];
    const v = validarCorreccionPrecio(orden, pedidos, motivo);
    if (v.error) return NextResponse.json({ error: v.error }, { status: 409 });
    const bcNo = String(orden.bcNumber);

    // 1) Las líneas del pedido en BC, para apuntar a cada una por su N.º.
    const leido = await bcLineasPedido(bcNo);
    if (!leido) {
      return NextResponse.json({
        error: `No se pudo leer el pedido ${bcNo} en Business Central, así que no se cambió ningún precio. Reintentá en un momento.`,
      }, { status: 502 });
    }
    const par = emparejarConBc(v.cambios, leido.lineas, bcNo);
    if (par.error) return NextResponse.json({ error: `NO se cambió el precio: ${par.error}` }, { status: 409 });

    // 2) BC. Si dice que no, no se tocó nada en ningún lado.
    try {
      await bcActualizarPreciosPedido(bcNo, par.lineas);
    } catch (e: any) {
      return NextResponse.json({ error: `NO se cambió el precio: ${String(e?.message ?? e)}` }, { status: 409 });
    }

    // 3) ¿Vuelve a quedar lanzada sola? Con el total NUEVO: un precio que sube puede
    //    pasar el tope y entonces sí tiene que pasar por Aprobación.
    const nueva = ordenConPrecios(orden, v.cambios.map((c) => ({ ordenLineaId: c.linea.id, precio: c.nuevo })));
    let relanzada = false;
    let aviso: string | undefined;
    let detalleAuto: string | undefined;
    if (aprobacionAutomaticaActiva()) {
      const bcT = await bcOrdenTotales(bcNo).catch(() => null);
      const decision = aprobacionAutomatica(orden, { app: ordenTotalConIva(nueva), bc: bcT ? bcT.total : null });
      if (decision.aplica) {
        try {
          const { estado: quedo, status } = await bcReleasePedidoVerificado(bcNo);
          if (quedo === "lanzado") { relanzada = true; detalleAuto = decision.detalle; }
          else aviso = `El precio quedó corregido, pero Business Central dejó el pedido ${bcNo} en "${status || "sin confirmar"}" en vez de lanzarlo. Quedó pendiente de aprobación.`;
        } catch (e: any) {
          aviso = `El precio quedó corregido, pero Business Central no dejó volver a lanzar el pedido ${bcNo}: ${String(e?.message ?? e)}. Quedó pendiente de aprobación.`;
        }
      }
    }

    // 4) La base.
    const detalle = detalleCorreccion(v.cambios, motivo, orden.currencyCode, [
      par.avisos.length ? `OJO: ${par.avisos.join("; ")}` : "",
      relanzada ? `relanzada en Business Central sin aprobación (${detalleAuto})` : "el pedido quedó Abierto en BC, pendiente de aprobación",
    ]);
    try {
      await corregirPreciosOrden(id, v.cambios.map((c) => ({ idOrdenCompraDet: Number(c.linea.id), precio: c.nuevo })), detalle, a.usuario, a.rol);
      if (relanzada) {
        // Ya estaba lanzada: el estado no cambia, pero el "nadie la aprobó" queda escrito.
        if (orden.estado !== "lanzado") {
          await setOrdenEstado(id, "lanzado", USUARIO_APROBACION_AUTOMATICA, a.rol, undefined, undefined,
            { tipoMovimiento: MOV_APROBACION_AUTOMATICA, detalle: detalleAuto });
        }
      } else if (orden.estado !== "pendiente_aprobacion") {
        await setOrdenEstado(id, "pendiente_aprobacion", a.usuario, a.rol, `precio corregido con material recibido: ${motivo}`);
      }
    } catch (e: any) {
      return NextResponse.json({
        error: `En Business Central el precio YA quedó corregido${relanzada ? " y el pedido se volvió a lanzar" : " (el pedido quedó Abierto)"}, pero acá no se pudo guardar: ${mensajeSeguro(e)}. `
          + "NO lo cambiés a mano en BC: reintentá «Corregir precio» con el mismo precio en un momento y la app lo toma.",
        bcYaCorregido: true,
      }, { status: 500 });
    }
    return NextResponse.json({
      ok: true, relanzada, pendienteAprobacion: !relanzada, aviso,
      avisos: par.avisos, cambiadas: v.cambios.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, `POST /api/ordenes/${params.id}/corregir-precio`) }, { status: 500 });
  }
}
