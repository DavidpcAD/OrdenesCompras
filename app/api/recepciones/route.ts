import { NextResponse } from "next/server";
import { createRecepcion, getOrden } from "@/lib/repo";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";
import { faltaMotivoRevision } from "@/lib/helpers";
import { bcNotaQueAnulaFactura, bcPedidoDeFacturaRegistrada } from "@/lib/bc";
import { duenoDeLaFactura, esFacturaAjena, numerosDeFactura, queHacerConFacturaYaUsada } from "@/lib/factura-ajena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CANDADO: una recepción que llega con `bcFacturaNo` dice "esto ya está registrado
// en BC como CFR-…". Por acá entran la conciliación y el guardado tras un posteo
// que sí entró. Antes de guardarla se mira en BC ese CFR: si salió de OTRO pedido,
// o se anuló con nota de crédito, guardarla deja la app diciendo que el material
// entró cuando en BC no entró (CP-006578 enlazada a CFR-012069 de CP-006485,
// anulada con CNCR-000507, 10 nov 2026). Si BC no contesta no se frena: el candado
// solo actúa con prueba, y una caída de BC no puede impedirle a Bodega guardar algo
// que sí se registró. Son dos lecturas cortas, y solo en este camino (el registro
// normal lo guarda el servidor en /api/bc/registrar, sin pasar por acá).
async function facturaQueNoSirve(idOrdenCompra: number, bcFacturaNo: string, numeroFactura: string): Promise<string | null> {
  const facturas = numerosDeFactura(bcFacturaNo);
  if (!facturas.length || !Number.isFinite(idOrdenCompra)) return null;
  const orden = await getOrden(idOrdenCompra).catch(() => null);
  const orderNo = orden?.bcNumber ?? "";
  if (!orderNo) return null;
  const queHacer = queHacerConFacturaYaUsada({ facturaProveedor: String(numeroFactura ?? "").trim() });
  const noEntro = `Este pedido NO está registrado en Business Central con esa factura, así que guardar la recepción acá `
    + `diría que el material entró cuando en BC no entró. `;
  for (const cfr of facturas) {
    const pedido = await bcPedidoDeFacturaRegistrada(cfr);
    if (esFacturaAjena(duenoDeLaFactura(pedido, orderNo))) {
      const deDonde = pedido ? `del pedido ${pedido}` : "registrada sin pedido";
      return `No se guardó: ${cfr} es ${deDonde}, no de ${orderNo}. ${noEntro}${queHacer}`;
    }
    const nota = await bcNotaQueAnulaFactura(cfr);
    if (nota) return `No se guardó: ${cfr} está anulada con la nota de crédito ${nota}. ${noEntro}${queHacer}`;
  }
  return null;
}

export async function POST(req: Request) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json();
    // Sin N.º de factura = va a revisión, y entonces el motivo es obligatorio (ver
    // faltaMotivoRevision). Las órdenes sin BC y el respaldo del navegador entran por acá.
    const sinMotivo = faltaMotivoRevision(body);
    if (sinMotivo) return NextResponse.json({ error: sinMotivo }, { status: 400 });
    const noSirve = await facturaQueNoSirve(Number(body?.idOrdenCompra), String(body?.bcFacturaNo ?? ""), String(body?.numeroFactura ?? ""));
    if (noSirve) return NextResponse.json({ error: noSirve, facturaYaUsada: true }, { status: 409 });
    const id = await createRecepcion({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idRecepcionCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, "POST /api/recepciones · registrar recepción") }, { status: 500 });
  }
}
