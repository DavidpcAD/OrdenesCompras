import { esLineaRecibible, monedaApp } from "./helpers";
import type { Orden, OrdenLinea } from "./types";

// LOS NÚMEROS DEL RESUMEN. Todo el cálculo de la pestaña "Resumen" vive acá, aparte
// de los componentes, porque son reglas del oficio y no de pintura — y porque una
// fórmula equivocada en un panel grande miente más fuerte que una tabla.
//
// Tres decisiones que valen por todo el archivo:
//
// 1. SIN CARGOS. Igual que el resumen por proveedor: un flete no es material que se
//    reciba, se reparte entre las demás líneas al registrar. Contarlo inflaría el
//    "pedido" sin que nunca aparezca nada por entregar.
// 2. SIN IVA, con descuento aplicado. Es el mismo importe que la columna "Total sin
//    IVA" de la lista de órdenes; si acá se calculara distinto, dos pantallas darían
//    dos números para lo mismo.
// 3. CADA MONEDA POR SU LADO. Las órdenes traen `currencyCode` ("" = colones, "USD").
//    Sumar colones con dólares da un número que no existe. Acá se agrupa por moneda y
//    la pantalla muestra la que manda, diciendo si hay otra aparte.

const importePedido = (l: OrdenLinea) => l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);
const importeRecibido = (l: OrdenLinea) => (l.cantidadRecibida ?? 0) * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);

// Moneda de la orden normalizada a una clave estable ("" y "CRC" son lo mismo).
export const monedaDe = (o: Orden) => monedaApp(o.currencyCode) || "CRC";

// Año y mes (0-11) de una fecha ISO, SIN pasar por `new Date`: "2026-01-01" se parsea
// como medianoche UTC y en Costa Rica (UTC−6) cae en diciembre del año anterior. Una
// orden del 1.º de enero se iba al año pasado y el YoY salía torcido (mismo motivo por
// el que `formatDate` lee los dígitos a mano).
export function anioMes(iso?: string): { anio: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? { anio: Number(m[1]), mes: Number(m[2]) - 1 } : null;
}

export type Serie = { pedido: number; recibido: number; ordenes: number };
const serieVacia = (): Serie => ({ pedido: 0, recibido: 0, ordenes: 0 });
const sumaSerie = (s: Serie[]) => s.reduce(
  (a, b) => ({ pedido: a.pedido + b.pedido, recibido: a.recibido + b.recibido, ordenes: a.ordenes + b.ordenes }),
  serieVacia(),
);

export type Segmento = { clave: string; etiqueta: string; monto: number; color: string };

export type KpisCompras = {
  moneda: string;                 // la moneda que manda (la de más órdenes)
  otrasMonedas: { moneda: string; ordenes: number }[]; // las que quedaron fuera de los montos
  anio: number;
  anioPrevio: number;
  // 12 meses del año en curso y del anterior. El previo se recorta al mes de hoy para
  // que la comparación sea de período contra período y no de 9 meses contra 12.
  meses: Serie[];
  mesesPrevio: Serie[];
  hayAnioPrevio: boolean;
  total: Serie;                   // acumulado del año en curso
  totalPrevio: Serie;             // mismo período del año anterior
  // Saldo VIVO (no del año): lo que se pidió y todavía no llega, de toda la historia.
  // `masViejoISO`: la orden más antigua que todavía debe material. Reemplaza al
  // "monto vencido" que no se pudo hacer: con `Expected Receipt Date` = `Order Date`
  // en el 100 % de las líneas, TODO sale vencido y la cifra roja repetiría el total.
  vivo: { pedido: number; recibido: number; pendiente: number; pct: number; masViejoISO: string | null };
  // Dónde está trabada la plata: órdenes que aún no se completan, por estado.
  porEstado: Segmento[];
  enCurso: number;                // suma de porEstado
};

export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Los estados donde la plata todavía no aterrizó, en el orden del flujo. El color es
// el mismo que lleva cada chip de filtro arriba, para que el anillo y los chips se
// lean como una sola cosa.
const ESTADOS_EN_CURSO: { clave: string; etiqueta: string; color: string }[] = [
  { clave: "abierto", etiqueta: "Abiertas (borrador)", color: "var(--ds-color-gray-300)" },
  { clave: "pendiente_aprobacion", etiqueta: "Pendientes de aprobación", color: "var(--ds-color-yellow)" },
  { clave: "rechazado", etiqueta: "Rechazadas", color: "var(--ds-color-red-200)" },
  { clave: "lanzado", etiqueta: "Lanzadas", color: "var(--ds-color-green-100)" },
];

export function kpisDeCompras(ordenes: Orden[], hoyISO: string): KpisCompras {
  const hoy = anioMes(hoyISO) ?? { anio: new Date().getFullYear(), mes: new Date().getMonth() };
  const anio = hoy.anio;
  const anioPrevio = anio - 1;

  // ── Qué moneda manda ──────────────────────────────────────────────────────
  // No se elige CRC a ciegas: se cuenta. Si algún día la mayoría de las órdenes
  // fueran en dólares, los montos saldrían en dólares y los colones quedarían
  // declarados aparte, en vez de sumarse en silencio a un total imposible.
  const cuentaMoneda = new Map<string, number>();
  for (const o of ordenes) cuentaMoneda.set(monedaDe(o), (cuentaMoneda.get(monedaDe(o)) ?? 0) + 1);
  const ranking = [...cuentaMoneda.entries()].sort((a, b) => b[1] - a[1]);
  const moneda = ranking[0]?.[0] ?? "CRC";
  const otrasMonedas = ranking.slice(1).map(([m, n]) => ({ moneda: m, ordenes: n }));

  const delaMoneda = ordenes.filter((o) => monedaDe(o) === moneda);

  // ── Series mensuales ──────────────────────────────────────────────────────
  const meses = Array.from({ length: 12 }, serieVacia);
  const mesesPrevio = Array.from({ length: 12 }, serieVacia);
  let hayAnioPrevio = false;

  for (const o of delaMoneda) {
    const f = anioMes(o.fecha);
    if (!f) continue;
    const destino = f.anio === anio ? meses : f.anio === anioPrevio ? mesesPrevio : null;
    if (!destino) continue;
    if (destino === mesesPrevio) hayAnioPrevio = true;
    const casilla = destino[f.mes];
    casilla.ordenes += 1;
    for (const l of o.lineas) {
      if (!esLineaRecibible(l)) continue;
      casilla.pedido += importePedido(l);
      casilla.recibido += importeRecibido(l);
    }
  }

  const total = sumaSerie(meses);
  // Mismo período: enero → el mes de hoy. Comparar el año entero contra 9 meses
  // daría una caída inventada cada vez que se abre la pantalla en setiembre.
  const totalPrevio = sumaSerie(mesesPrevio.slice(0, hoy.mes + 1));

  // ── Saldo vivo y plata trabada por estado ─────────────────────────────────
  const porEstadoMonto = new Map<string, number>();
  let pedidoVivo = 0;
  let recibidoVivo = 0;
  let masViejoISO: string | null = null;
  for (const o of delaMoneda) {
    let pedido = 0;
    let recibido = 0;
    let debe = false;
    for (const l of o.lineas) {
      if (!esLineaRecibible(l)) continue;
      pedido += importePedido(l);
      recibido += importeRecibido(l);
      if ((l.cantidadRecibida ?? 0) < l.cantidad) debe = true;
    }
    if (debe && o.fecha && (!masViejoISO || o.fecha < masViejoISO)) masViejoISO = o.fecha;
    pedidoVivo += pedido;
    recibidoVivo += recibido;
    if (ESTADOS_EN_CURSO.some((e) => e.clave === o.estado)) {
      porEstadoMonto.set(o.estado, (porEstadoMonto.get(o.estado) ?? 0) + pedido);
    }
  }

  const porEstado = ESTADOS_EN_CURSO
    .map((e) => ({ ...e, monto: porEstadoMonto.get(e.clave) ?? 0 }))
    .filter((e) => e.monto > 0);
  const enCurso = porEstado.reduce((s, e) => s + e.monto, 0);

  const pendiente = Math.max(0, pedidoVivo - recibidoVivo);
  return {
    moneda, otrasMonedas, anio, anioPrevio,
    meses, mesesPrevio, hayAnioPrevio,
    total, totalPrevio,
    vivo: {
      pedido: pedidoVivo,
      recibido: recibidoVivo,
      pendiente,
      pct: pedidoVivo > 0 ? Math.round((recibidoVivo / pedidoVivo) * 100) : 0,
      masViejoISO,
    },
    porEstado, enCurso,
  };
}

// Días enteros entre dos fechas ISO, leyendo los dígitos y no `new Date(iso)`: en
// UTC−6 ese parseo corre un día, y con tramos de 15 días un día importa.
export function diasDesde(iso: string | null | undefined, hoyISO: string): number | null {
  const a = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")?.[1];
  const b = /^(\d{4}-\d{2}-\d{2})/.exec(hoyISO)?.[1];
  if (!a || !b) return null;
  const d = Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

// La variación contra el mismo período del año anterior. Devuelve null cuando no hay
// con qué comparar: un "+100 %" porque el año pasado no había datos es una mentira
// con flecha verde, y en una pantalla de trabajo eso se lee y se cree.
export function variacion(actual: number, previo: number): number | null {
  if (!previo) return null;
  return ((actual - previo) / Math.abs(previo)) * 100;
}
