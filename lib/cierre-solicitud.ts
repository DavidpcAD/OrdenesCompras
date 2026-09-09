/* ============================================================================
   CERRAR UNA SOLICITUD — la parte pura (sin SQL, sin React), para poder probarla.

   Qué es cerrar: la solicitud se ordenó a medias y lo que quedó sin ordenar YA NO
   SE VA A COMPRAR (cambió el alcance, se consiguió en otro lado, la obra no lo
   necesita). Se archiva con el motivo escrito y el saldo deja de estar pendiente.
   Lo que SÍ se ordenó no se toca: esas órdenes siguen su curso, se reciben y se
   facturan igual.

   Por qué este archivo existe aparte de repo.ts: el único requisito que David
   enunció de forma explícita es "SIEMPRE poner una nota del porqué", y esa regla
   vivía en un lugar que `npm test` no puede tocar (la suite no importa lib/repo.ts
   ni ningún route handler, porque los dos abren conexiones a SQL). Acá la regla es
   una función pura con su test, y repo.ts la llama.

   ---- Dónde vive el cierre en la base -------------------------------------------
   SOLO en el ENCABEZADO: `dbo.PedidoCompra.idEstado` = Cerrado, `notaCreador` con
   el motivo, y el movimiento en `dbo.Movimiento`. En las LÍNEAS no se marca nada,
   y no es por simplificar: el `updatePedido` de la app de Producción hace

       DELETE FROM dbo.PedidoCompraDet
        WHERE idPedidoCompra=@id AND quantityOrdenado=0
          AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCompraDet o WHERE …)

   y reinserta las líneas desde su payload. Las líneas que este feature cancela son
   EXACTAMENTE las que cumplen esa condición (sin ordenar y sin orden que las
   referencie), así que una marca por línea se borraría sola la próxima vez que el
   ingeniero edite su solicitud — sin movimiento, sin aviso y semanas después del
   QA. Los tres lugares donde sí se escribe (idEstado del encabezado, notaCreador y
   la bitácora) sobreviven a ese DELETE, porque ninguno es una fila de detalle.

   Del lado del front la línea cancelada se DERIVA (ver `lineaCancelada`): el
   encabezado está cerrado y a la línea le quedaba saldo.
   ============================================================================ */

// Marca del cierre en `notaCreador`. Misma idea que el "↩" de la devolución: el
// campo hace doble oficio (comentario del ingeniero + motivos internos), así que el
// prefijo es lo que permite separarlos después.
export const PREFIJO_CIERRE = "⛔ Cerrada:";
export const PREFIJO_DEVOLUCION = "↩";

// Los símbolos con los que arranca un encabezado INTERNO de la nota. Todo lo que
// empiece con uno de estos es para nosotros, no para el proveedor.
const MARCAS_INTERNAS = ["⛔", "↩"];

// `dbo.PedidoCompra.notaCreador` es NVARCHAR(500) (db/schema_compras_boletas_style.sql).
// El cierre CONCATENA sobre la nota previa, así que el desborde no necesita un motivo
// largo: alcanza con un comentario de ingeniero ya largo más el prefijo.
export const MAX_NOTA = 500;

const SEP = " · ";

/** Los tramos de una nota: el encabezado interno (si hay) va primero. */
export function segmentosDeNota(notas?: string): string[] {
  return (notas ?? "").trim().split(SEP).map((s) => s.trim()).filter(Boolean);
}

const esInterno = (segmento: string) => MARCAS_INTERNAS.some((m) => segmento.startsWith(m));

/**
 * Lo que queda de la nota una vez sacados TODOS los encabezados internos.
 *
 * Se sacan en bucle y no de a uno a propósito: una solicitud que se devolvió y
 * después se cerró tiene los dos prefijos apilados ("⛔ Cerrada: … · ↩ Devuelto: …
 * · <comentario>"). Recortando uno solo, el motivo de la devolución —que es interno,
 * del tipo "el ingeniero pidió de más"— terminaba impreso en el PDF del proveedor.
 */
export function comentarioSinMarcasInternas(notas?: string): string {
  const segs = segmentosDeNota(notas);
  let i = 0;
  while (i < segs.length && esInterno(segs[i])) i++;
  return segs.slice(i).join(SEP);
}

/**
 * El motivo del cierre, leído de la nota. Devuelve "" si la solicitud no se cerró
 * con nota (solicitudes viejas, o cerradas por fuera de la app).
 *
 * Se lee de `notaCreador` y no de la bitácora porque la nota es el único canal que
 * la app de Producción ya muestra hoy: el ingeniero ve el porqué en su lista sin
 * tener que abrir el detalle.
 */
export function motivoDeCierre(notas?: string): string {
  const seg = segmentosDeNota(notas).find((s) => s.startsWith(PREFIJO_CIERRE));
  return seg ? seg.slice(PREFIJO_CIERRE.length).trim() : "";
}

export const MSG_MOTIVO_CIERRE =
  "Escribí por qué se cierra la solicitud: queda en el historial y es lo que va a leer el ingeniero.";

/**
 * El motivo, limpio y obligatorio. Es LA regla del feature, y por eso tira en vez
 * de devolver un default: una solicitud archivada sin explicación no se puede
 * reconstruir después.
 */
export function motivoObligatorio(motivo?: string): string {
  const t = String(motivo ?? "").trim();
  if (!t) throw new Error(MSG_MOTIVO_CIERRE);
  return t;
}

/**
 * La nota del pedido después del cierre: el motivo adelante, lo que hubiera atrás.
 *
 * El cierre va PRIMERO y la devolución vieja queda detrás porque es el estado más
 * reciente y el que explica en qué terminó la solicitud; y recortada a MAX_NOTA,
 * que es lo que aguanta la columna.
 */
export function componerNotaCierre(motivo: string, notaPrevia?: string): string {
  const limpio = motivoObligatorio(motivo);
  const previa = (notaPrevia ?? "").trim();
  return `${PREFIJO_CIERRE} ${limpio}${previa ? `${SEP}${previa}` : ""}`.slice(0, MAX_NOTA);
}

/** La nota cuando se DESHACE el cierre: se le saca el encabezado del cierre y nada más. */
export function quitarNotaCierre(notas?: string): string {
  const segs = segmentosDeNota(notas);
  const i = segs.findIndex((s) => s.startsWith(PREFIJO_CIERRE));
  if (i < 0) return (notas ?? "").trim().slice(0, MAX_NOTA);
  return segs.filter((_, n) => n !== i).join(SEP).slice(0, MAX_NOTA);
}

export interface ResumenCierre {
  /** Descripciones de las líneas que quedaron sin comprar. */
  nombres: string[];
  /** Unidades que se dan de baja (suma de los saldos). */
  unidades: number;
}

/**
 * El detalle que va a `dbo.Movimiento`: QUÉ se dio de baja y por qué.
 *
 * El separador " · Motivo: " no es decorativo — es la convención que ya parsea
 * `devolucionesDeSolicitudes` en repo.ts, y las dos apps leen esta misma bitácora.
 */
export function detalleDeCierre(r: ResumenCierre, motivo: string): string {
  const limpio = motivoObligatorio(motivo);
  const cuantas = r.nombres.length;
  const cabeza = cuantas
    ? `Cerrada con ${cuantas} línea(s) sin ordenar (${formatearUnidades(r.unidades)} u.): ${r.nombres.join("; ")}`
    : "Cerrada sin saldo pendiente";
  return `${cabeza}${SEP}Motivo: ${limpio}`;
}

// Sin Intl: este módulo lo usa el server, donde el locale no está garantizado, y el
// número acá es informativo (va dentro de un texto de bitácora). Se redondea a 2
// decimales para que un saldo de 0.30000000000000004 no ensucie el historial.
function formatearUnidades(n: number): string {
  return String(Math.round((Number(n) || 0) * 100) / 100);
}

/**
 * ¿Esta línea es de las que el cierre dio de baja?
 *
 * DERIVADO, no persistido (ver el encabezado del archivo): el encabezado está
 * cerrado y a la línea le quedaba algo sin ordenar. Una línea que se ordenó entera
 * NO cuenta como cancelada — esa sí se compró, y mostrarla tachada sería mentir.
 */
export function lineaCancelada(
  pedidoCerrado: boolean, cantidad: number, cantidadOrdenada: number,
): boolean {
  return pedidoCerrado && (Number(cantidad) || 0) - (Number(cantidadOrdenada) || 0) > 1e-9;
}
