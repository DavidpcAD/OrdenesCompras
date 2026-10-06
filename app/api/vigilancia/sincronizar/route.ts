import { NextResponse } from "next/server";
import { facturasYProveedoresDeBc } from "@/lib/bc-facturas-cache";
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
//
// RESPONDE EN CHORRO (NDJSON, una línea por avance) y no de un solo golpe al final.
// La corrida se toma su tiempo —abre adjuntos uno a uno y baja miles de facturas— y
// un botón que dice "Revisando…" sin más deja a la persona sin saber si está pasando
// algo o si se colgó. Cada línea es `{fase, hechos, total}` y la última trae el
// resultado con `fin: true`. Si algo se traga el chorro, igual llega esa última línea
// y la pantalla funciona: el avance se pierde, el resultado no.

const TRASLAPE_MIN = 10;

// ── UNA REVISIÓN A LA VEZ ───────────────────────────────────────────────────
//
// Microsoft no deja más de cuatro peticiones simultáneas por app y por buzón, y esta
// ruta abre adjuntos en lote. Dos corridas encimadas se pasan del tope solas y Graph
// contesta 429 `ApplicationThrottled` —pasó el 5 de octubre de 2026—.
//
// Encimarse es fácil: la pantalla revisa sola cada 3 minutos POR PESTAÑA, así que dos
// pestañas abiertas —o dos personas en Auditoría— ya son dos corridas, y una corrida
// lenta alcanza a la siguiente.
//
// La segunda no espera ni falla: se cierra limpia y la pantalla recarga la lista, que
// es lo único que iba a conseguir de todos modos.
//
// OJO: el candado es de ESTE proceso. Si Azure levanta más de una instancia, cada una
// tiene el suyo — alcanza para lo que de verdad pasa (varias pestañas contra la misma
// instancia) y no pretende ser un candado distribuido. Y vence solo: una corrida que
// se quede colgada en un socket no puede dejar la auditoría muerta para siempre.
const CORRIDA_MAX_MIN = 15;
let corriendoDesde: number | null = null;
const hayCorrida = () => corriendoDesde !== null && Date.now() - corriendoDesde < CORRIDA_MAX_MIN * 60_000;

export async function POST() {
  const buzon = estadoBuzon();

  if (!(await tablaCorreoExiste())) {
    return NextResponse.json({ ok: false, paso: "tabla", error: FALTA_TABLA, buzon }, { status: 503 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emitir = (o: unknown) => {
        try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* cliente se fue */ }
      };
      if (hayCorrida()) {
        emitir({
          fin: true, ok: true, buzon, yaCorriendo: true,
          correo: { leidos: 0, nuevos: 0, error: null },
          cotejo: { cotejados: 0, aparecieron: 0, error: null },
        });
        controller.close();
        return;
      }
      corriendoDesde = Date.now();
      try {
        await correr(buzon, emitir);
      } catch (e: any) {
        emitir({ fin: true, ok: false, buzon, correo: { leidos: 0, nuevos: 0, error: e?.message ?? "Falló la sincronización." }, cotejo: { cotejados: 0, aparecieron: 0, error: null } });
      } finally {
        corriendoDesde = null;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Sin esto, un proxy puede juntar todo y entregarlo al final: el avance se
      // perdería y volveríamos al botón mudo.
      "X-Accel-Buffering": "no",
    },
  });
}

async function correr(buzon: ReturnType<typeof estadoBuzon>, emitir: (o: unknown) => void) {
  let leidos = 0, nuevos = 0, errorCorreo: string | null = null;

  // --- 1 y 2: el buzón --------------------------------------------------------
  if (buzon.listo) {
    try {
      emitir({ fase: "correo", hechos: 0, total: 0 });
      const sync = await leerSincronizacion();
      const desde = sync?.marcador ? conTraslape(sync.marcador) : null;
      const r = await leerBuzon(desde, (p) => emitir({ fase: "correo", ...p }));
      leidos = r.leidos;
      const entradas = r.correos.flatMap((c) =>
        c.comprobantes.map((comprobante) => ({
          comprobante, fechaCorreo: c.recibido, webLink: c.webLink, remitente: c.remitente,
        })),
      );
      nuevos = await guardarComprobantes(entradas, (h, t) => emitir({ fase: "guardando", hechos: h, total: t }));
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
      emitir({ fase: "bc", hechos: 0, total: pendientes.length });
      const comprobantes: Comprobante[] = pendientes.map((p) => ({
        clave: p.clave, consecutivo: p.consecutivo, tipo: p.tipoDoc,
        cedulaEmisor: p.cedulaEmisor, nombreEmisor: p.nombreEmisor,
        cedulaReceptor: p.cedulaReceptor, fecha: p.fechaEmision,
        total: p.total, moneda: p.moneda,
      }));
      const masVieja = comprobantes.map((c) => c.fecha).filter(Boolean).sort()[0] ?? "";
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(masVieja) ? corre(masVieja, -30) : "2025-11-01";

      const { facturas, proveedores } = await facturasYProveedoresDeBc(desde);
      emitir({ fase: "cotejo", hechos: 0, total: pendientes.length });
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
      await guardarCotejo(resultados, (h, t) => emitir({ fase: "anotando", hechos: h, total: t }));
      cotejados = pendientes.length;
      aparecieron = cruce.calzadas.length + cruce.descuadradas.length;
    }
  } catch (e: any) {
    errorBc = e?.message ?? "No se pudo cotejar contra Business Central.";
  }

  emitir({
    fin: true,
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
