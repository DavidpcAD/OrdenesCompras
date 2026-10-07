import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { contarVivos, listNotasCredito, listOrdenes, listPedidos, listRecepciones } from "@/lib/repo";
import { cursorDe, siguienteCursor, tamañoDeLote } from "@/lib/lotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cronómetro de cada parte de la carga. Existe porque "dura mucho" no se puede
// arreglar a ojo: hay que saber si el tiempo se va en SQL, en Business Central o en
// el tamaño de la respuesta. Sale por dos lados: al log del server (Azure Log Stream)
// y en la cabecera Server-Timing, que el navegador muestra en Red → Tiempos sin
// pedirle nada a nadie.
async function medir<T>(marcas: Record<string, number>, nombre: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { return await fn(); } finally { marcas[nombre] = Date.now() - t0; }
}

// ── CARGA POR LOTES ──────────────────────────────────────────────────────────
// Sin parámetros esto sigue siendo lo de siempre: la historia entera en un viaje,
// con su ETag. Es lo que usa el refresco de 45 s, donde el 304 ahorra el viaje.
//
// Con `?n=` la respuesta es UN LOTE: los N más nuevos de cada cosa, más un cursor
// por entidad para pedir el siguiente. El cliente pinta el primer lote y sigue
// pidiendo hacia atrás (ver lib/store.tsx). Así la pantalla deja de esperar a que
// termine de armarse toda la historia para mostrar la primera fila.
//
// Por qué el lote NO lleva ETag: un lote es un pedazo, y el ETag de la app es la
// huella de TODO (es lo que le dice al refresco "nada cambió"). Mezclarlos haría que
// un lote parezca la foto completa y el refresco siguiente se saltara datos.
// Interruptor de emergencia: `BOOTSTRAP_LOTES=0` en el App Service y la carga vuelve
// a ser un solo viaje, SIN redeploy (igual que BC_FRENO_PRECIO o AUTORIZACION_ROLES).
// El cliente no se entera de nada: recibe un único lote con todo adentro y marcado
// como completo, así que deja de pedir y sigue su vida.
function lotesActivos(): boolean {
  const v = (process.env.BOOTSTRAP_LOTES ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

async function responderLote(req: Request, nPedido: number, marcas: Record<string, number>, t0: number) {
  const activos = lotesActivos();
  // Apagado: se piden las listas SIN techo y todo viaja en esta misma respuesta.
  const n = activos ? nPedido : null;
  const url = new URL(req.url);
  const cur = {
    pedidos: cursorDe(url.searchParams.get("pc")),
    ordenes: cursorDe(url.searchParams.get("oc")),
    recepciones: cursorDe(url.searchParams.get("rc")),
  };
  // Primera vuelta = la que no trae ningún cursor. Solo ahí viajan las notas de
  // crédito (son pocas y no se paginan) y los totales, que son los que dejan decir
  // "600 de 787" en vez de un "cargando…" sin fondo.
  const primera = cur.pedidos == null && cur.ordenes == null && cur.recepciones == null;
  // `fin` = esta entidad ya se terminó en una vuelta anterior; no se vuelve a consultar.
  const fin = (c: number | null) => !primera && c == null;

  const [pedidos, ordenes, recepciones, notas, totales] = await Promise.all([
    fin(cur.pedidos) ? [] : medir(marcas, "pedidos", () => listPedidos({ antesDeId: cur.pedidos, limite: n })),
    fin(cur.ordenes) ? [] : medir(marcas, "ordenes", () => listOrdenes({ antesDeId: cur.ordenes, limite: n })),
    fin(cur.recepciones) ? [] : medir(marcas, "recepciones", () => listRecepciones({ antesDeId: cur.recepciones, limite: n })),
    primera ? medir(marcas, "notas", () => listNotasCredito().catch(() => [])) : [],
    primera ? medir(marcas, "totales", () => contarVivos().catch(() => null)) : null,
  ]);

  const cursores = n == null ? { pedidos: null, ordenes: null, recepciones: null } : {
    pedidos: fin(cur.pedidos) ? null : siguienteCursor(pedidos, n),
    ordenes: fin(cur.ordenes) ? null : siguienteCursor(ordenes, n),
    recepciones: fin(cur.recepciones) ? null : siguienteCursor(recepciones, n),
  };
  const completo = cursores.pedidos == null && cursores.ordenes == null && cursores.recepciones == null;
  marcas.total = Date.now() - t0;

  const body = JSON.stringify({ pedidos, ordenes, recepciones, notas, cursores, completo, totales });
  const kb = Math.round(Buffer.byteLength(body) / 1024);
  console.info(`[bootstrap:lote] ${marcas.total} ms · ${kb} kB · n=${n ?? "sin techo (BOOTSTRAP_LOTES apagado)"}${primera ? " (primero)" : ""} · ${pedidos.length} solicitudes, ${ordenes.length} órdenes, ${recepciones.length} recepciones${completo ? " · COMPLETO" : ""}`);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Server-Timing": Object.entries(marcas).map(([k, v]) => `${k};dur=${v}`).join(", "),
    },
  });
}

// Carga inicial de la data para el front-end (modo API).
// NO incluye el historial de movimientos: la tabla dbo.Movimiento completa viajaba
// en cada carga Y en cada auto-refresh (45s) solo para pintar el Timeline de dos
// pantallas de detalle. Ahora el Timeline lo pide por entidad a /api/movimientos.
export async function GET(req: Request) {
  const marcas: Record<string, number> = {};
  const t0 = Date.now();
  try {
    // ¿Vienen por lotes? Entonces el camino es otro: pedazos sin ETag.
    const n = tamañoDeLote(new URL(req.url).searchParams.get("n"));
    if (n != null) return await responderLote(req, n, marcas, t0);

    const [pedidos, ordenes, recepciones, notas] = await Promise.all([
      medir(marcas, "pedidos", listPedidos),
      medir(marcas, "ordenes", listOrdenes),
      medir(marcas, "recepciones", listRecepciones),
      // Las notas de crédito viajan ACÁ (antes eran un segundo request cada 45 s).
      // Si la tabla no existe todavía, se devuelven vacías sin tumbar la carga.
      medir(marcas, "notas", () => listNotasCredito().catch(() => [])),
    ]);

    // ETag = huella de EXACTAMENTE lo que se iba a enviar. Con la app abierta todo
    // el día el refresco corre cada 45 s y casi siempre trae lo mismo: sin esto,
    // cada vuelta bajaba todas las órdenes con sus líneas por datos móviles y el
    // celular las volvía a parsear. Con el 304 el cuerpo no viaja.
    //
    // Se calcula sobre el payload real (no sobre conteos ni fechas de la base) a
    // propósito: cualquier atajo se arriesga a NO detectar un cambio y dejar la
    // pantalla vieja creyendo que está al día, que es justo lo que hay que evitar.
    const body = JSON.stringify({ pedidos, ordenes, recepciones, notas });
    const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
    marcas.total = Date.now() - t0;

    const kb = Math.round(Buffer.byteLength(body) / 1024);
    // Las LÍNEAS, no solo los encabezados: el peso del payload se va casi todo ahí y
    // ninguna de las tres consultas tiene techo —traen toda la historia—, así que este
    // número es el que dice cuándo hay que empezar a acotar por fecha. Se cuentan (O(n)
    // y barato); medir los bytes de cada bloque obligaría a serializarlo aparte, que es
    // justo el trabajo que acá se está tratando de no hacer de más.
    const nLineas = (xs: Array<{ lineas?: unknown[] }>) => xs.reduce((t, x) => t + (x.lineas?.length ?? 0), 0);
    console.info(`[bootstrap] ${marcas.total} ms · ${kb} kB · ${pedidos.length} solicitudes (${nLineas(pedidos)} líneas), ${ordenes.length} órdenes (${nLineas(ordenes)} líneas), ${recepciones.length} recepciones (${nLineas(recepciones)} líneas), ${notas.length} notas · pedidos ${marcas.pedidos} ms, ordenes ${marcas.ordenes} ms, recepciones ${marcas.recepciones} ms, notas ${marcas.notas} ms`);
    const serverTiming = Object.entries(marcas).map(([k, v]) => `${k};dur=${v}`).join(", ");

    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, "Server-Timing": serverTiming } });
    }
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ETag: etag, "Server-Timing": serverTiming },
    });
  } catch (e: any) {
    // El detalle va al log del server (Azure), NO a la pantalla: el mensaje crudo
    // de mssql dice motor, host y puerto ("Failed to connect to …:1433"), o sea le
    // cuenta la infraestructura a cualquiera que abra la app. Igual que en el login.
    console.error("bootstrap", e);
    return NextResponse.json(
      { error: "No se pudo consultar la base de datos ahora mismo. Reintentá; si sigue, avisale a TI." },
      { status: 500 }
    );
  }
}
