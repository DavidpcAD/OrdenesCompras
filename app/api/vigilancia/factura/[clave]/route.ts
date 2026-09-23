import { NextResponse } from "next/server";
import { bcFacturaCompraConLineas, type BcFacturaCompraDetalle } from "@/lib/bc";
import { leerLineasXml, leerResumenXml, type LineaComprobante, type ResumenComprobante } from "@/lib/cruce-correo-bc";
import { estadoBuzon, xmlDeComprobante } from "@/lib/graph-buzon";
import { leerFacturaCorreo, tablaCorreoExiste, FALTA_TABLA } from "@/lib/repo-facturas-correo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vigilancia/factura/<clave de 50 dígitos>
//
// LOS DOS LADOS DE UNA FACTURA: lo que cobró el proveedor y lo que se digitó en BC,
// línea por línea. La lista de la auditoría contesta "¿está en BC?"; esto contesta la
// siguiente, que es la que cuesta plata: "¿está por lo mismo, y por lo mismo QUÉ?".
//
// Cada lado va por su lado y se traen en paralelo:
//   · el del correo, del XML adjunto (Graph), buscado por la clave del comprobante;
//   · el de BC, de la factura de compra con sus líneas.
//
// Si uno falla, el otro igual se muestra con su error al lado. Son dos sistemas
// distintos: que Graph esté caído no es razón para esconder lo que BC sí contestó.

export type LadoCorreo =
  | { ok: true; archivo: string; lineas: LineaComprobante[]; resumen: ResumenComprobante }
  | { ok: false; error: string };

export type LadoBc =
  | { ok: true; factura: BcFacturaCompraDetalle }
  | { ok: false; error: string };

export async function GET(_req: Request, { params }: { params: { clave: string } }) {
  try {
    const clave = String(params.clave ?? "").trim();
    if (clave.length !== 50) {
      return NextResponse.json({ error: "La clave del comprobante no tiene 50 dígitos." }, { status: 400 });
    }
    if (!(await tablaCorreoExiste())) {
      return NextResponse.json({ error: FALTA_TABLA }, { status: 503 });
    }

    const factura = await leerFacturaCorreo(clave);
    if (!factura) {
      return NextResponse.json({ error: "Ese comprobante no está en la auditoría." }, { status: 404 });
    }

    const [correo, bc] = await Promise.all([ladoCorreo(factura.webLink, clave), ladoBc(factura.bcNumero)]);
    return NextResponse.json({ factura, correo, bc });
  } catch (e: any) {
    console.error("vigilancia/factura GET:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "No se pudo abrir la factura." }, { status: 500 });
  }
}

async function ladoCorreo(webLink: string | null, clave: string): Promise<LadoCorreo> {
  const buzon = estadoBuzon();
  if (!buzon.listo) return { ok: false, error: buzon.falta };
  if (!webLink) {
    return { ok: false, error: "De este comprobante no se guardó el correo de origen, así que no hay XML que abrir." };
  }
  try {
    const adj = await xmlDeComprobante(webLink, clave);
    if (!adj) {
      return {
        ok: false,
        error: "El XML ya no está en ese correo. Puede que lo movieran de carpeta o lo borraran; el enlace de arriba abre el correo en Outlook.",
      };
    }
    return { ok: true, archivo: adj.archivo, lineas: leerLineasXml(adj.xml), resumen: leerResumenXml(adj.xml) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "No se pudo leer el XML del correo." };
  }
}

async function ladoBc(bcNumero: string | null): Promise<LadoBc> {
  if (!bcNumero) return { ok: false, error: "Todavía no se ha encontrado esta factura en Business Central." };
  try {
    const factura = await bcFacturaCompraConLineas(bcNumero);
    if (!factura) {
      return { ok: false, error: `Business Central ya no tiene la factura ${bcNumero}.` };
    }
    return { ok: true, factura };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "No se pudo leer la factura en Business Central." };
  }
}
