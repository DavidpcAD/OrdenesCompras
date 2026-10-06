import { NextResponse } from "next/server";
import { bcFacturarRecibido, reponerLanzamientoTrasFallo, type EstadoBcPedido, verificarLineasPosteables, frenoRegistroActivo, conflictoDeDimensiones, explicarConflictoDimensiones, faltaConfigContable, explicarFaltaConfigContable, campoVacioEnBc, explicarCampoVacioEnBc, fechaFueraDeRangoBc, explicarFechaFueraDeRangoBc } from "@/lib/bc";
import { frenarPorEncabezado } from "@/lib/freno-encabezado";
import { frenarPorPrecio } from "@/lib/freno-precio";
import { actor } from "@/lib/actor";
import type { Role } from "@/lib/types";
import { marcarFacturadaTrasBc } from "@/lib/guardado-tras-bc";
import { anotarFalloDeBc } from "@/lib/fallo-posteo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Registrar la factura de lo YA recibido (Kattya, tras revisar) Y marcarla
// facturada acá, en la misma llamada.
// body: { orderNo, vendorInvoiceNo, lineas: [{itemNo, qty}], facturar? }
//
// El `facturar` cierra el mismo hueco que en /api/bc/registrar: que el movimiento
// local no dependa de un segundo viaje del navegador. Ver lib/guardado-tras-bc.ts.
export async function POST(req: Request) {
  // El body se lee FUERA del try porque el catch necesita el `orderNo` para poder
  // decir de qué pedido habla el error (adentro quedaba fuera de alcance).
  const cuerpo = await req.json().catch(() => ({} as any));
  const { orderNo, vendorInvoiceNo, lineas, ordenId, vendorNo } = cuerpo ?? {};
  // Se declara ACÁ y no dentro del try porque el catch también lo necesita: el
  // intento fallido se anota a nombre de quien lo hizo (ver lib/fallo-posteo.ts).
  let quien: { usuario: string; rol: Role } | null = null;
  // Cómo estaba el pedido en BC al EMPEZAR, según el freno de encabezado. Es lo
  // único que después permite saber si el posteo lo des-lanzó (ver abajo).
  let estadoBc: EstadoBcPedido | undefined;
  try {
    // FRENO 1 — el ENCABEZADO del pedido en BC: mismo proveedor y LANZADO allá
    // (ver lib/freno-encabezado.ts). Acá es lo último que queda antes de que la
    // cuenta por pagar se mueva: si algo del encabezado no calza, no se factura.
    const frenoProv = await frenarPorEncabezado(orderNo, ordenId, vendorNo, "facturar");
    estadoBc = frenoProv.estadoBc;
    if (frenoProv.freno) return NextResponse.json(frenoProv.freno, { status: 409 });
    // Acá el saldo que importa es lo RECIBIDO SIN FACTURAR: el codeunit filtra por
    // "Qty. Rcd. Not Invoiced" y, si no calza, se salta la línea sin decir nada.
    // BC_FRENO_REGISTRO=0 lo apaga desde Azure: si el chequeo diera un falso
    // positivo, Bodega no podría recibir un camión y no se puede esperar un despliegue.
    const freno = frenoRegistroActivo()
      ? await verificarLineasPosteables(String(orderNo ?? ""), lineas ?? [], "facturar-recibido")
      : { ok: true, problemas: [] as string[], verificado: false, bc: undefined };
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
    // FRENO 3 — EL MONTO: que lo que BC va a facturar sea lo que la orden dice.
    // La app no le manda precios al registrar (solo N.º y cantidad), así que BC
    // factura con lo que tenga la línea del pedido: un precio, un IVA o una unidad
    // distintos allá se convierten en plata mal puesta sin que nadie lo vea. Reusa
    // las líneas que el freno anterior ya leyó. BC_FRENO_PRECIO=0 lo apaga desde
    // Azure. Ver lib/freno-precio.ts.
    const frenoMonto = await frenarPorPrecio({
      orden: frenoProv.orden, orderNo: String(orderNo ?? ""), pedidas: lineas ?? [],
      accion: "facturar", bcYaLeido: freno.bc,
    }).catch(() => null);   // el freno nunca puede tumbar un registro por su cuenta
    if (frenoMonto) return NextResponse.json(frenoMonto, { status: 409 });
    // Quién factura, de la cookie firmada (ver lib/actor.ts): sobrescribe en el pedido
    // el nombre que dejó la recepción, porque es este registro el que crea el consumo.
    quien = await actor(cuerpo);
    const postedNo = await bcFacturarRecibido(orderNo, vendorInvoiceNo, lineas ?? [], "", quien.usuario);
    // La factura ya está registrada en BC: la recepción se marca facturada acá mismo.
    const guardado = await marcarFacturadaTrasBc(cuerpo?.facturar, quien);
    return NextResponse.json({ ok: true, postedNo, ...guardado });
  } catch (e: any) {
    const error = String(e?.message ?? e);
    // RED DE ATRÁS — el posteo pudo des-lanzar el pedido en BC sin que la app se
    // enterara: el codeunit lo reabre solo para poder moverle la fecha de registro a
    // un pedido en moneda extranjera. Si al empezar constaba LANZADO y ahora está
    // Abierto, se lo devuelve así. Ver reponerLanzamientoTrasFallo en lib/bc.ts.
    const vuelta = await reponerLanzamientoTrasFallo(String(orderNo ?? ""), estadoBc);
    const avisoVuelta = vuelta ? ` · ${vuelta.texto}` : "";
    // El intento que no entró queda escrito en la orden, y si el pedido quedó ABIERTO
    // en Business Central la orden lo dice sola (aviso rojo del detalle). Nunca tumba
    // la respuesta del error real: ver lib/fallo-posteo.ts.
    await anotarFalloDeBc({
      error: error + avisoVuelta, ordenId, orderNo, accion: "facturar", quien, causa: e,
      pedidoAbierto: vuelta?.quedoAbierto ? String(orderNo ?? "") : undefined,
    });
    // Choque de DIMENSIONES (el CC que el almacén amarra en BC): no se reintenta —
    // cada intento da el mismo error— y BC no registró nada. Se explica y se corta.
    // Ver conflictoDeDimensiones en lib/bc.ts.
    // PERIODO CONTABLE CERRADO en BC: la fecha de registro cae fuera del rango
    // permitido. No es la orden ni la factura, y reintentar con LA MISMA FECHA da
    // siempre lo mismo, así que va al aviso que se queda en pantalla en vez de al
    // toast de "queda para reintentar". Ver fechaFueraDeRangoBc en lib/bc.ts.
    if (fechaFueraDeRangoBc(error)) {
      return NextResponse.json({
        ok: false, error: `NO se facturó: ${explicarFechaFueraDeRangoBc("")}${avisoVuelta}`,
        frenoFechaBc: true,
      }, { status: 409 });
    }
    const dim = conflictoDeDimensiones(error);
    if (dim) {
      return NextResponse.json({
        ok: false, error: `NO se facturó: ${explicarConflictoDimensiones(dim, String(orderNo ?? ""))}${avisoVuelta}`,
        frenoDimensiones: true, dimensiones: dim,
      }, { status: 409 });
    }
    // FALTA CONFIGURACIÓN CONTABLE en BC (la combinación almacén × grupo de registro
    // que nunca se dio de alta): mismo trato que el choque de dimensiones —no se
    // reintenta, BC no registró nada y no hay qué conciliar—, pero lo arregla
    // Contabilidad y no Proveeduría. Ver faltaConfigContable en lib/bc.ts.
    const cfg = faltaConfigContable(error);
    if (cfg) {
      return NextResponse.json({
        ok: false, error: `NO se facturó: ${explicarFaltaConfigContable(cfg, String(orderNo ?? ""))}${avisoVuelta}`,
        frenoConfigBc: true, configFaltante: cfg,
      }, { status: 409 });
    }
    // Y una FICHA maestra de BC a medio llenar: mismo desenlace, pero lo completa
    // quien mantiene esa ficha. Ver campoVacioEnBc en lib/bc.ts.
    const ficha = campoVacioEnBc(error);
    if (ficha) {
      return NextResponse.json({
        ok: false, error: `NO se facturó: ${explicarCampoVacioEnBc(ficha)}${avisoVuelta}`,
        frenoFichaBc: true, fichaIncompleta: ficha,
      }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error + avisoVuelta }, { status: 502 });
  }
}
