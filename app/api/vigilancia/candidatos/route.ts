import { NextRequest, NextResponse } from "next/server";
import { facturasYProveedoresDeBc } from "@/lib/bc-facturas-cache";
import { candidatosDeFactura, type MarcaCandidato } from "@/lib/candidatos-bc";
import { bcNumerosEnlazados, listarFacturasCorreo, tablaCorreoExiste } from "@/lib/repo-facturas-correo";
import { soloDigitos } from "@/lib/vigilancia-facturas";
import type { FacturaBc } from "@/lib/vigilancia-facturas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vigilancia/candidatos?desde=2026-09-01&hasta=2026-09-30
//
// CUÁLES DE LAS "SIN REGISTRAR" TIENEN PINTA DE ESTAR EN BC CON OTRO NÚMERO.
//
// Sin esto la función de candidatos no sirve de nada en la práctica: hay 393
// comprobantes sin registrar y nadie va a abrirlos uno por uno a ver si alguno tiene
// sugerencia. Con esto la tabla los marca y se puede filtrar por "tiene candidato",
// que es lo que convierte una lista de 393 en una tarde de trabajo.
//
// Va APARTE de la lista y no adentro: la lista tiene que abrir de una, leyendo solo
// SQL, y esto necesita bajarse las facturas de BC. La pantalla pinta primero y las
// marcas caen encima cuando llegan.

const DIAS_ATRAS = 45;

export async function GET(req: NextRequest) {
  try {
    if (!(await tablaCorreoExiste())) return NextResponse.json({ marcas: {} });

    const sp = req.nextUrl.searchParams;
    const iso = (v: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? (v as string) : undefined);
    const desde = iso(sp.get("desde")) ?? hace(60);
    const hasta = iso(sp.get("hasta"));

    const filas = (await listarFacturasCorreo({ desde, hasta })).filter((f) => f.estado === "pendiente");
    if (!filas.length) return NextResponse.json({ marcas: {} });

    const masVieja = filas.map((f) => f.fechaEmision).filter(Boolean).sort()[0] ?? desde;
    const [{ facturas, proveedores }, enlazadas] = await Promise.all([
      facturasYProveedoresDeBc(corre(masVieja, -DIAS_ATRAS)),
      bcNumerosEnlazados(),
    ]);

    // Las facturas de BC se agrupan por la CÉDULA de su proveedor una sola vez. Sin
    // esto, cada comprobante recorre las ~10.000 facturas enteras y con varios cientos
    // de pendientes la petición se vuelve lenta sin necesidad: el proveedor es
    // requisito para ser candidato, así que el resto nunca iba a calificar.
    const cedulaDe = new Map<string, string>();
    const proveedoresSinCedula: string[] = [];
    for (const p of proveedores) {
      const c = soloDigitos(p.cedula);
      if (c.length >= 9) cedulaDe.set(p.codigo, c);
      else proveedoresSinCedula.push(p.codigo);
    }
    const sinCedula = new Set(proveedoresSinCedula);
    const porCedula = new Map<string, FacturaBc[]>();
    const deProveedorSinCedula: FacturaBc[] = [];
    for (const f of facturas) {
      const c = cedulaDe.get(f.proveedorCodigo);
      if (c) {
        const g = porCedula.get(c);
        if (g) g.push(f); else porCedula.set(c, [f]);
      } else if (sinCedula.has(f.proveedorCodigo)) {
        // Las fichas sin cédula solo se pueden reconocer por el nombre, así que hay
        // que ofrecérselas todas a todos. Son la minoría de las facturas.
        deProveedorSinCedula.push(f);
      }
    }

    const marcas: Record<string, MarcaCandidato> = {};
    for (const f of filas) {
      const ced = soloDigitos(f.cedulaEmisor);
      const mirar = [...(porCedula.get(ced) ?? []), ...deProveedorSinCedula];
      if (!mirar.length) continue;
      const c = candidatosDeFactura(
        {
          consecutivo: f.consecutivo, cedulaEmisor: f.cedulaEmisor, nombreEmisor: f.nombreEmisor,
          fecha: f.fechaEmision, total: f.total, moneda: f.moneda,
        },
        mirar, proveedores, { yaEnlazadas: enlazadas },
      );
      if (!c.length) continue;
      marcas[f.clave] = {
        n: c.length,
        numero: c[0].factura.numero,
        numeroProveedor: c[0].factura.numeroProveedor,
        fecha: c[0].factura.fecha,
        difMonto: c[0].difMonto,
        dias: c[0].dias,
        puntaje: c[0].puntaje,
      };
    }

    return NextResponse.json({ marcas, revisadas: filas.length });
  } catch (e: any) {
    console.error("vigilancia/candidatos GET:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "No se pudieron buscar candidatos." }, { status: 500 });
  }
}

function hace(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
}

function corre(iso: string, dias: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}
