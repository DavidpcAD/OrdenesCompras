import { NextResponse } from "next/server";
import { bcFacturasCompra, bcProveedoresConCedula } from "@/lib/bc";
import { cruzar, type Comprobante } from "@/lib/cruce-correo-bc";
import { estadoBuzon, leerBuzon } from "@/lib/graph-buzon";
import {
  tablaCorreoExiste, FALTA_TABLA, guardarComprobantes, pendientesDeCotejo,
  guardarCotejo, leerSincronizacion, guardarSincronizacion,
  type ResultadoCotejo,
} from "@/lib/repo-facturas-correo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/vigilancia/sincronizar
//
// LA VUELTA COMPLETA, y es la que hace que esto sea automático:
//
//   1. Lee del buzón los correos nuevos desde el marcador y les saca los XML.
//   2. Guarda los comprobantes que no estaban (la clave de Hacienda es la llave, así
//      que un reenvío no duplica).
//   3. Vuelve a cotejar contra Business Central TODO lo que sigue pendiente —no solo
//      lo nuevo— porque una factura de hace diez días se puede digitar hoy, y el
//      momento en que aparece es justo lo que hay que detectar.
//   4. Anota cuáles aparecieron y CUÁNDO, que es lo que contesta "¿ya se registró?".
//
// Corre sola: la llama la pantalla al abrirse y cada pocos minutos mientras está
// abierta. Es idempotente, así que llamarla de más no hace daño.
//
// Se relee con traslape de 10 minutos a propósito: un correo que entra mientras corre
// la sincronización se perdería si el marcador avanzara al filo del último leído.

const TRASLAPE_MIN = 10;

export async function POST() {
  const buzon = estadoBuzon();

  if (!(await tablaCorreoExiste())) {
    return NextResponse.json({ ok: false, paso: "tabla", error: FALTA_TABLA, buzon }, { status: 503 });
  }

  let leidos = 0, nuevos = 0, errorCorreo: string | null = null;

  // --- 1 y 2: el buzón --------------------------------------------------------
  if (buzon.listo) {
    try {
      const sync = await leerSincronizacion();
      const desde = sync?.marcador ? conTraslape(sync.marcador) : null;
      const r = await leerBuzon(desde);
      leidos = r.leidos;
      const entradas = r.correos.flatMap((c) =>
        c.comprobantes.map((comprobante) => ({
          comprobante, fechaCorreo: c.recibido, webLink: c.webLink, remitente: c.remitente,
        })),
      );
      nuevos = await guardarComprobantes(entradas);
      await guardarSincronizacion({ marcador: r.masNuevo, error: null, leidos, nuevos });
    } catch (e: any) {
      errorCorreo = e?.message ?? "No se pudo leer el buzón.";
      await guardarSincronizacion({ error: errorCorreo }).catch(() => {});
    }
  }

  // --- 3 y 4: el cotejo contra BC --------------------------------------------
  // Se hace aunque el buzón haya fallado: lo ya guardado se sigue vigilando.
  let cotejados = 0, aparecieron = 0, errorBc: string | null = null;
  try {
    const pendientes = await pendientesDeCotejo();
    if (pendientes.length) {
      const comprobantes: Comprobante[] = pendientes.map((p) => ({
        clave: p.clave, consecutivo: p.consecutivo, tipo: p.tipoDoc,
        cedulaEmisor: p.cedulaEmisor, nombreEmisor: p.nombreEmisor,
        cedulaReceptor: p.cedulaReceptor, fecha: p.fechaEmision,
        total: p.total, moneda: p.moneda,
      }));
      const masVieja = comprobantes.map((c) => c.fecha).filter(Boolean).sort()[0] ?? "";
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(masVieja) ? corre(masVieja, -30) : "2025-11-01";

      const [facturas, proveedores] = await Promise.all([
        bcFacturasCompra(desde),
        bcProveedoresConCedula(),
      ]);
      const cruce = cruzar(comprobantes, facturas, proveedores);

      const resultados: ResultadoCotejo[] = [
        ...cruce.calzadas.map((c) => ({
          clave: c.comprobante.clave, estado: "registrada" as const,
          bcNumero: c.factura.numero, bcProveedor: c.factura.proveedorCodigo,
          bcTotal: c.factura.total, bcCalzePor: c.por,
        })),
        ...cruce.descuadradas.map((c) => ({
          clave: c.comprobante.clave, estado: "descuadrada" as const,
          bcNumero: c.factura.numero, bcProveedor: c.factura.proveedorCodigo,
          bcTotal: c.factura.total, bcCalzePor: c.por,
        })),
        // Lo que viene a nombre de otra cédula se archiva solo: no es que falte
        // digitarlo, es que nunca fue de esta compañía.
        ...cruce.otrasEmpresas.map((c) => ({ clave: c.clave, estado: "otra_empresa" as const })),
        // Las que siguen sin aparecer vuelven a quedar pendientes, pero con la fecha
        // de cotejo al día para saber que sí se revisaron.
        ...cruce.soloEnCorreo.map((c) => ({ clave: c.clave, estado: "pendiente" as const })),
      ];
      await guardarCotejo(resultados);
      cotejados = pendientes.length;
      aparecieron = cruce.calzadas.length + cruce.descuadradas.length;
    }
  } catch (e: any) {
    errorBc = e?.message ?? "No se pudo cotejar contra Business Central.";
  }

  return NextResponse.json({
    ok: !errorCorreo && !errorBc,
    buzon,
    correo: { leidos, nuevos, error: errorCorreo },
    cotejo: { cotejados, aparecieron, error: errorBc },
  });
}

function conTraslape(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t - TRASLAPE_MIN * 60_000).toISOString();
}

function corre(iso: string, dias: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}
