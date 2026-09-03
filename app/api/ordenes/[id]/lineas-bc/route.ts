import { NextResponse } from "next/server";
import { getOrden } from "@/lib/repo";
import { bcLineasPedido } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ordenes/123/lineas-bc
// Las líneas que el pedido de esta orden tiene AHORA en Business Central.
//
// Para qué: cuando Proveeduría le devuelve el material al ingeniero, las líneas salen
// de la orden y con ellas se van los precios que ya estaban negociados — pero el
// pedido de BC las conserva. Al traer de vuelta el material corregido hay que ponerle
// ESE precio, no "el último precio de compra del artículo": el de la orden es el que
// se le cotizó al proveedor, y el histórico puede ser de otra obra, otra cantidad u
// otro año (en CP-005294 la diferencia era de ₡21.300).
//
// Solo lectura y nunca 500: si BC no contesta, devuelve la lista vacía y quien llama
// se cae al precio histórico como antes.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const o = await getOrden(Number(params.id));
    if (!o?.bcNumber) return NextResponse.json({ lineas: [] });
    const bc = await bcLineasPedido(o.bcNumber);
    const lineas = (bc?.lineas ?? [])
      .filter((l) => l.tipo === "articulo" && l.itemNo)
      .map((l) => ({
        itemNo: l.itemNo, variantCode: l.variantCode ?? "", unidad: l.unidad ?? "",
        precioUnitario: l.precioUnitario, cantidad: l.cantidad, almacen: l.almacen ?? "",
      }));
    return NextResponse.json({ lineas, fuente: bc?.fuente });
  } catch {
    return NextResponse.json({ lineas: [] });
  }
}
