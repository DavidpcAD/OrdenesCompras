import { pedidoOrdenadoPct } from "./helpers.ts";
import type { Pedido } from "./types.ts";

// LOS FILTROS DE LA PESTAÑA "SOLICITUDES" DE COMPRAS.
//
// Las tarjetas de arriba y las pastillas de abajo son UN solo filtro: tocar
// cualquiera de ellas deja exactamente una cosa elegida. Las tarjetas son la cola de
// trabajo de Proveeduría (lo que todavía hay que comprar); las pastillas, lo que se
// consulta de vez en cuando (todo, lo ya ordenado, lo archivado).
//
// "Por gestionar" es la suma de "Sin orden de compra" + "Parcialmente ordenadas", y
// "Urgentes" sale de ESA misma cola: una urgente que ya se ordenó completa ya no le
// toca a nadie, y contarla haría que el número rojo no bajara nunca.
//
// "archivadas" no es un avance de compra como los otros: es el estado del documento.
// Por eso se resuelve antes del avance — meterla adentro haría que una archivada al
// 60 % contara en "Parcialmente ordenadas".

export type FiltroSolicitudes =
  | "gestionar" | "pendiente" | "parcial" | "urgentes"
  | "todas" | "ordenado" | "archivadas";

export const FILTROS_SOLICITUDES: FiltroSolicitudes[] = [
  "gestionar", "pendiente", "parcial", "urgentes", "todas", "ordenado", "archivadas",
];

type Avance = "pendiente" | "parcial" | "ordenado";

export function avanceDeSolicitud(p: Pedido): Avance {
  const pct = pedidoOrdenadoPct(p);
  return pct >= 100 ? "ordenado" : pct > 0 ? "parcial" : "pendiente";
}

/** Proveeduría solo ve lo ENVIADO: ni el borrador ni lo devuelto (siguen en manos del
 *  ingeniero) ni lo archivado, que tiene su propia pastilla. */
export const esEnviada = (p: Pedido) => p.estado !== "borrador" && p.estado !== "devuelto" && p.estado !== "cerrado";

export function cumpleFiltro(p: Pedido, f: FiltroSolicitudes): boolean {
  if (f === "archivadas") return p.estado === "cerrado";
  if (!esEnviada(p)) return false;
  if (f === "todas") return true;
  const a = avanceDeSolicitud(p);
  if (f === "gestionar") return a !== "ordenado";
  if (f === "urgentes") return a !== "ordenado" && p.prioridad === "urgente";
  return a === f;
}

export function filtrarSolicitudes(pedidos: Pedido[], f: FiltroSolicitudes): Pedido[] {
  return pedidos.filter((p) => cumpleFiltro(p, f));
}

export function conteoSolicitudes(pedidos: Pedido[]): Record<FiltroSolicitudes, number> {
  const n = Object.fromEntries(FILTROS_SOLICITUDES.map((f) => [f, 0])) as Record<FiltroSolicitudes, number>;
  for (const p of pedidos) for (const f of FILTROS_SOLICITUDES) if (cumpleFiltro(p, f)) n[f]++;
  return n;
}

/** Días entre la fecha de la solicitud y hoy, contados por CALENDARIO. Se leen los
 *  dígitos con regex y se cuenta en UTC: con `new Date("2026-11-20")` en UTC−6 la
 *  fecha se corre al día anterior. `null` si la fecha no se puede leer. */
export function diasDesde(fechaISO: string, hoyISO: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaISO ?? "");
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(hoyISO ?? "");
  if (!a || !b) return null;
  const ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3]);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** "hoy" / "ayer" / "hace 5 días" — cuánto lleva esperando la solicitud. */
export function esperaTexto(dias: number | null): string {
  if (dias === null) return "";
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}
