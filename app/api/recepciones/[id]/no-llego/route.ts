import { NextResponse } from "next/server";
import { lineasParaNoLlego, marcarRecepcionNoLlego } from "@/lib/repo";
import { bcLineasPedido } from "@/lib/bc";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";
import { faltaDeshacerEnBc } from "@/lib/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "NO LLEGÓ": saca de revisión una recepción cuyo material nunca llegó, y la orden
// deja de contarlo como recibido. La app NO deshace la recepción en BC: lo mira. Si
// allá el pedido todavía tiene ese material recibido, no deja (ver faltaDeshacerEnBc).
// body: { motivo }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json().catch(() => ({} as any));
    const motivo = String(body?.motivo ?? "").trim();
    if (!motivo) return NextResponse.json({ error: "Poné por qué no llegó: queda en el historial de la orden." }, { status: 400 });
    const idRec = Number(params.id);
    if (!Number.isInteger(idRec) || idRec <= 0) return NextResponse.json({ error: "Recepción inválida. Recargá la página." }, { status: 400 });

    const info = await lineasParaNoLlego(idRec);
    if (info.orderNo) {
      // Sin poder leer BC no se puede confirmar nada: no se toca la base.
      const bc = await bcLineasPedido(info.orderNo).catch(() => null);
      if (!bc) {
        return NextResponse.json({
          error: `No se pudo leer el pedido ${info.orderNo} en Business Central, así que no se puede confirmar que allá ya no conste recibido. No se tocó nada: reintentá en un momento.`,
        }, { status: 409 });
      }
      const lineas = info.lineas.map((l) => {
        // La línea del pedido por N.º de línea y artículo; si no calza, por artículo
        // solo cuando hay una única línea con ese artículo. Si no, no se adivina.
        const mismas = bc.lineas.filter((b) => b.itemNo === l.itemNo);
        const b = mismas.find((x) => x.lineNo === l.lineNum) ?? (mismas.length === 1 ? mismas[0] : undefined);
        return { descripcion: l.descripcion || l.itemNo, unidad: l.unidad, enEsta: l.enEsta, recibidaApp: l.recibidaApp, recibidaBc: b?.recibida };
      });
      const falta = faltaDeshacerEnBc(lineas);
      if (falta) return NextResponse.json({ error: falta, frenoBc: true }, { status: 409 });
    }

    const a = await actor({ ...body, rol: body?.rol ?? "facturacion" });
    const r = await marcarRecepcionNoLlego(idRec, motivo, a.usuario, a.rol);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 409 });
  }
}
