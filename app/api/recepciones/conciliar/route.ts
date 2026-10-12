import { NextResponse } from "next/server";
import { getOrden, createRecepcion } from "@/lib/repo";
import { bcFacturasRegistradasDePedido, bcLineasFacturadasDePedido } from "@/lib/bc";
import { decidirConciliacion } from "@/lib/conciliar-orden";
import { actor } from "@/lib/actor";
import { todayISO } from "@/lib/helpers";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/recepciones/conciliar  { ordenId }
//
// Pone al día, de un clic, una orden que BC YA facturó y la app no registró (una
// persona la registró a mano en BC, por fuera de Bodega). Lee BC, verifica que el
// caso sea limpio (ver lib/conciliar-orden.ts) y, sólo entonces, guarda la recepción
// ACÁ apuntando a la factura que allá ya existe — SIN volver a registrar nada en BC.
//
// La seguridad es del lado del servidor: el cuerpo trae SOLO el id de la orden. Las
// facturas, el proveedor, las líneas y los montos los lee la app de BC; el navegador
// no puede inyectar qué conciliar ni por cuánto.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.ordenId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Falta el id de la orden a conciliar." }, { status: 400 });
    }

    const orden = await getOrden(id);
    if (!orden) return NextResponse.json({ error: "La orden no existe." }, { status: 404 });
    if (!orden.bcNumber) {
      return NextResponse.json({ error: "La orden todavía no tiene pedido en Business Central." }, { status: 400 });
    }

    const [facturas, lineasBc] = await Promise.all([
      bcFacturasRegistradasDePedido(orden.bcNumber),
      bcLineasFacturadasDePedido(orden.bcNumber),
    ]);
    // null = no se pudo leer BC. No se concilia a ciegas: "no pude leer" nunca es "no hay".
    if (facturas === null) {
      return NextResponse.json({ error: "No se pudo leer Business Central (facturas del pedido). Probá de nuevo en un momento." }, { status: 502 });
    }

    const dec = decidirConciliacion(
      {
        id: orden.id,
        bcNumber: orden.bcNumber,
        proveedorNo: orden.proveedorNo,
        proveedorId: orden.proveedorId,
        lineas: orden.lineas.map((l) => ({
          id: l.id, tipo: l.tipo, articuloId: l.articuloId, variantCode: l.variantCode,
          descripcion: l.descripcion, cantidad: l.cantidad, cantidadRecibida: l.cantidadRecibida,
          precioUnitario: l.precioUnitario, unidad: l.unidad,
        })),
      },
      facturas.map((f) => ({
        numero: f.numero, facturaProveedor: f.facturaProveedor, vendorNo: f.vendorNo,
        total: f.total, currencyCode: f.currencyCode, fecha: f.fecha, status: f.status,
      })),
      lineasBc ?? [],
    );
    // 409 = el estado de BC/la orden no permite conciliar automático (anulada, de otro
    // proveedor, ya recibida, líneas que no cuadran). El motivo va al toast de la página.
    if (!dec.ok) return NextResponse.json({ error: dec.motivo }, { status: 409 });

    // La identidad sale de la cookie firmada, no del body (igual que /api/recepciones).
    const a = await actor(body);
    const hoy = todayISO();
    const fechaFactura = dec.plan.fechaFactura || hoy;
    const idRec = await createRecepcion({
      idOrdenCompra: id,
      numeroFactura: dec.plan.numeroFactura,
      fechaFactura,
      fechaRecepcion: fechaFactura,
      fechaRegistro: hoy,
      total: dec.plan.total,
      lineas: dec.plan.lineas,
      bcFacturaNo: dec.plan.bcFacturaNo,
      nota: dec.plan.nota,
      usuario: a.usuario,
      rol: a.rol,
    });

    return NextResponse.json(
      { ok: true, idRecepcionCompra: idRec, facturas: dec.plan.facturas, numeroFactura: dec.plan.numeroFactura },
      { status: 201 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, "POST /api/recepciones/conciliar · conciliar orden ya facturada en BC") }, { status: 500 });
  }
}
