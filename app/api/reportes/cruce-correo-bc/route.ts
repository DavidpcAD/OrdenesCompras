import { NextRequest, NextResponse } from "next/server";
import { bcFacturasCompra, bcProveedoresConCedula } from "@/lib/bc";
import { cruzar, type Comprobante } from "@/lib/cruce-correo-bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/reportes/cruce-correo-bc   { comprobantes: Comprobante[] }
//
// EL CRUCE. Recibe los comprobantes que llegaron al correo y los coteja contra las
// facturas de compra de Business Central. Devuelve las tres listas: las que calzan, las
// que están en BC y no llegaron por correo, y las que llegaron y no están en BC.
//
// Los XML se leen EN EL NAVEGADOR y acá llega solo lo ya extraído. Así el archivo
// nunca sale de la máquina de quien lo carga, la petición pesa unos pocos kilobytes en
// vez de decenas de megas, y cargar mil comprobantes no depende de subirlos.
//
// Mientras no exista el permiso de Entra para que la app lea el buzón sola, los
// comprobantes entran por carga manual. Cuando exista, el ingestor va a escribir en el
// mismo formato y esta ruta no cambia.

const TOPE = 5000;   // un mes del buzón son ~600 comprobantes; 5.000 es año y pico

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const comprobantes: Comprobante[] = Array.isArray(body?.comprobantes) ? body.comprobantes : [];
    if (!comprobantes.length) {
      return NextResponse.json({ error: "No llegó ningún comprobante para cruzar." }, { status: 400 });
    }
    if (comprobantes.length > TOPE) {
      return NextResponse.json(
        { error: `Son ${comprobantes.length} comprobantes y el tope es ${TOPE}. Cargá por tandas más cortas.` },
        { status: 413 },
      );
    }

    // Se leen las facturas de BC desde un poco antes del comprobante más viejo: si la
    // factura se digitó con fecha anterior a la emisión (pasa), quedaría fuera y saldría
    // como faltante sin serlo.
    const masVieja = comprobantes.map((c) => c.fecha).filter(Boolean).sort()[0] ?? "";
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(masVieja) ? corre(masVieja, -30) : "2025-11-01";

    const [facturas, proveedores] = await Promise.all([
      bcFacturasCompra(desde),
      bcProveedoresConCedula(),
    ]);

    const r = cruzar(comprobantes, facturas, proveedores);

    return NextResponse.json({
      leidos: comprobantes.length,
      facturasBc: facturas.length,
      ventana: r.ventana,
      calzadas: { n: r.calzadas.length, filas: r.calzadas },
      descuadradas: { n: r.descuadradas.length, filas: r.descuadradas },
      soloEnCorreo: { n: r.soloEnCorreo.length, filas: r.soloEnCorreo },
      soloEnBc: { n: r.soloEnBc.length, filas: r.soloEnBc },
      otrasEmpresas: { n: r.otrasEmpresas.length, filas: r.otrasEmpresas },
    });
  } catch (e: any) {
    console.error("cruce-correo-bc:", e?.message ?? e);
    return NextResponse.json(
      { error: `No se pudo cruzar contra Business Central: ${e?.message ?? "error desconocido"}` },
      { status: 502 },
    );
  }
}

function corre(iso: string, dias: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}
