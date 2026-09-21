// CUENTAS CON FECHAS "SOLO DÍA" (YYYY-MM-DD), SIN TOCAR LA ZONA HORARIA.
//
// En esta app la fecha de una orden es un día, no un instante: "2026-09-21". La trampa
// conocida es meter eso en `new Date("2026-09-21")`, que se parsea como medianoche UTC
// y en Costa Rica (UTC−6) devuelve el día anterior — el mismo bug que ya obligó a
// escribir `formatDate` y `isoLocal` en lib/helpers.ts. Acá las cuentas se hacen sobre
// los números del texto y, cuando hace falta sumar días, con `Date.UTC`, que no tiene
// ni zona ni horario de verano. El resultado siempre vuelve como texto YYYY-MM-DD.

export type Rango = { from?: string; to?: string };

export const ES_ISO = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const p2 = (n: number) => String(n).padStart(2, "0");

export const isoDe = (y: number, m: number, d: number): string => `${y}-${p2(m)}-${p2(d)}`;

export function partes(iso: string): { y: number; m: number; d: number } | null {
  if (!ES_ISO(iso)) return null;
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

// Cuántos días tiene el mes (m es 1-12). El día 0 del mes siguiente es el último de este.
export const diasEnMes = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Qué día de la semana cae el 1.º, contando desde el LUNES (0 = lunes … 6 = domingo).
// La semana arranca el lunes porque así la muestran el calendario del sistema en
// español y el resto de la app.
export const primerDiaSemana = (y: number, m: number): number => (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

// Sumar (o restar) días a una fecha "solo día". Con Date.UTC no hay zona que corra el
// resultado un día para atrás.
export function sumarDias(iso: string, n: number): string {
  const p = partes(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return isoDe(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Correr el mes mostrado. Devuelve {y, m} con m en 1-12.
export function sumarMeses(y: number, m: number, n: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

export const primeroDelMes = (y: number, m: number): string => isoDe(y, m, 1);
export const ultimoDelMes = (y: number, m: number): string => isoDe(y, m, diasEnMes(y, m));

// "junio 2026" — en español, con el mes en minúscula como lo escribe es-CR.
export function nombreMes(y: number, m: number): string {
  const t = new Intl.DateTimeFormat("es-CR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
  return t.replace(" de ", " ");
}

// Comparar fechas "solo día" es comparar sus textos: el formato YYYY-MM-DD ordena solo.
export const entre = (iso: string, a: string, b: string): boolean => (a <= b ? iso >= a && iso <= b : iso >= b && iso <= a);

// El rango siempre sale en orden, aunque se hayan elegido las puntas al revés.
export function ordenarRango(r: Rango): Rango {
  if (r.from && r.to && r.from > r.to) return { from: r.to, to: r.from };
  return r;
}

export const rangoVacio = (r: Rango | undefined): boolean => !r || (!r.from && !r.to);

// Cómo se lee un rango en un botón: "21/06/2026 → 21/09/2026", "desde el 21/06/2026",
// "hasta el 21/09/2026". Sin rango, el texto que le pase la pantalla.
export function textoRango(r: Rango | undefined, vacio = "Cualquier fecha"): string {
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  if (rangoVacio(r)) return vacio;
  const { from, to } = r!;
  if (from && to) return from === to ? dmy(from) : `${dmy(from)} → ${dmy(to)}`;
  if (from) return `desde el ${dmy(from)}`;
  return `hasta el ${dmy(to!)}`;
}
