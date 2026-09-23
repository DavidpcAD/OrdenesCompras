import { NextRequest, NextResponse } from "next/server";
import { estadoBuzon } from "@/lib/graph-buzon";
import {
  tablaCorreoExiste, FALTA_TABLA, listarFacturasCorreo, leerSincronizacion, marcarFacturaCorreo,
  marcarRevisada, type EstadoFactura,
} from "@/lib/repo-facturas-correo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/vigilancia/facturas?desde=2026-09-01&hasta=2026-09-30  → lo que llegó al correo y en qué quedó
// POST /api/vigilancia/facturas  { clave, revisada }        → palomearla como revisada
// POST /api/vigilancia/facturas  { clave, estado, nota }    → cerrarla a mano
//
// Esta es la lista que mira Contabilidad: cada comprobante que entró al buzón, si ya
// se registró en BC, con qué número y cuándo apareció. No consulta ni el correo ni BC:
// lee lo que dejó la sincronización, así que abre de una aunque BC esté lento.

const DIAS_POR_DEFECTO = 60;

export async function GET(req: NextRequest) {
  try {
    if (!(await tablaCorreoExiste())) {
      return NextResponse.json({
        hayTabla: false, error: FALTA_TABLA, buzon: estadoBuzon(), filas: [], sync: null,
      });
    }
    const sp = req.nextUrl.searchParams;
    const iso = (v: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? (v as string) : undefined);
    // Sin rango elegido se muestran los últimos 60 días; con rango se respeta, para
    // poder irse más atrás sin traerse toda la tabla en cada carga.
    const desde = iso(sp.get("desde")) ?? hace(DIAS_POR_DEFECTO);
    const hasta = iso(sp.get("hasta"));

    const [filas, sync] = await Promise.all([
      listarFacturasCorreo({ desde, hasta }),
      leerSincronizacion(),
    ]);

    return NextResponse.json({ hayTabla: true, desde, hasta, buzon: estadoBuzon(), sync, filas });
  } catch (e: any) {
    console.error("vigilancia/facturas GET:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "No se pudo leer la lista." }, { status: 500 });
  }
}

const CERRABLES: EstadoFactura[] = ["no_aplica", "otra_empresa", "pendiente"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const clave = String(body?.clave ?? "").trim();
    if (clave.length !== 50) {
      return NextResponse.json({ error: "Falta la clave del comprobante." }, { status: 400 });
    }

    const a = await actor({}).catch(() => ({ usuario: "sistema" }));
    const usuario = (a as any).usuario ?? "sistema";

    // La palomita de revisado va aparte del estado: revisar no es resolver.
    if (typeof body?.revisada === "boolean") {
      await marcarRevisada(clave, body.revisada, usuario);
      return NextResponse.json({ ok: true });
    }

    const estado = String(body?.estado ?? "") as EstadoFactura;
    // Solo se puede cerrar a mano lo que es criterio de una persona. "Registrada" no
    // se marca a dedo: esa la pone el cotejo cuando encuentra la factura en BC, y si
    // se pudiera forzar, la pantalla dejaría de ser una fuente de verdad.
    if (!CERRABLES.includes(estado)) {
      return NextResponse.json(
        { error: `No se puede marcar como "${estado}" a mano. Solo: ${CERRABLES.join(", ")}.` },
        { status: 400 },
      );
    }
    await marcarFacturaCorreo(clave, estado, usuario, body?.nota);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("vigilancia/facturas POST:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "No se pudo marcar." }, { status: 500 });
  }
}

function hace(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
}
