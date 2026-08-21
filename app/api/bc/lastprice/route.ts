import { NextResponse } from "next/server";
import {
  bcUltimoPrecioFacturado, bcUltimaCompraDocumento, bcItemUltimaCompra, bcItemLastCost, bcUnidadesDeCompra,
} from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Último precio de compra de un material, CON LA UNIDAD Y LA MONEDA a las que
// corresponde. Devolver el número solo fue el origen del error que le ponía ₡1,74
// a un estañón de adhesivo: 1,74 era el costo por GRAMO y la línea estaba en
// estañones (255.000 gramos cada uno).
//
// Prioridad:
//  1) "proveedor": precio con que se le FACTURÓ a ese proveedor (lo más preciso;
//     trae la unidad de la línea facturada y la moneda de la factura).
//  2) "compra": última RECEPCIÓN registrada del material — precio por la unidad
//     con la que se compró, en la moneda del documento.
//  3) "movimiento": costo por unidad BASE del movimiento de inventario (colones).
//  4) "item": último costo directo que BC guarda en el ítem (colones, unidad base).
//
// `unidad` dice a qué unidad corresponde `precio`, y `factor` cuántas unidades base
// trae la unidad de compra — con eso el llamador convierte, o decide no hacerlo.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const item = u.searchParams.get("item") ?? "";
  const vendor = u.searchParams.get("vendor") ?? "";
  try {
    const unidades = (await bcUnidadesDeCompra())[item];
    const base = unidades?.base ?? "";
    const factor = unidades?.factor;

    const fact = await bcUltimoPrecioFacturado(item, vendor);
    if (fact) {
      return NextResponse.json({
        precio: fact.precio, unidad: fact.unidad || base, moneda: fact.moneda, factor, fuente: "proveedor",
      });
    }

    const compra = await bcUltimaCompraDocumento(item);
    if (compra) {
      return NextResponse.json({
        precio: compra.precio, unidad: compra.unidad, moneda: compra.moneda,
        factor: compra.factor || factor, fuente: "compra",
      });
    }

    // Respaldo: el costo por unidad base del movimiento de inventario. Va SIEMPRE
    // en colones y en la unidad base; se devuelve así rotulado para que quien lo
    // use lo convierta con el factor, o no lo use.
    const mov = await bcItemUltimaCompra(item);
    if (mov != null) {
      return NextResponse.json({ precio: mov, unidad: base, moneda: "CRC", factor, fuente: "movimiento" });
    }

    const itemCost = await bcItemLastCost(item);
    if (itemCost != null) {
      return NextResponse.json({ precio: itemCost, unidad: base, moneda: "CRC", factor, fuente: "item" });
    }

    return NextResponse.json({ precio: null, unidad: base, moneda: "", factor, fuente: null });
  } catch (e: any) {
    return NextResponse.json({ precio: null, unidad: "", moneda: "", fuente: null, error: String(e?.message ?? e) });
  }
}
