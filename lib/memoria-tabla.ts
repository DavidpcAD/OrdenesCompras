// LO QUE SE ESTÁ BUSCANDO TIENE FECHA DE VENCIMIENTO.
//
// La tabla recuerda en sessionStorage lo que uno está buscando —la barra de búsqueda,
// los filtros de columna, en qué página va— para que filtrar, entrar a un detalle y
// volver devuelva la lista tal como se dejó. Eso es correcto para una vuelta de
// segundos y es un bug al tercer día: Angie abrió Órdenes el lunes y vio 5 de 465
// porque la barra todavía traía el proveedor que había buscado el VIERNES.
//
// Faltaba la otra mitad de la pregunta. Se preguntaba si uno VENÍA DE VUELTA, y
// mientras se trabaje DENTRO de la pantalla —abrir una orden y volver, tocar un panel,
// recargar con F5— cada movimiento contesta que sí: la cadena nunca se rompe y la
// búsqueda se hereda de un día para otro. Ahora también se pregunta CUÁNDO. Pasada la
// ventana, la lista se abre completa, que es lo único que nunca está mal.
export const VENTANA_BUSQUEDA_MS = 30 * 60 * 1000;   // media hora

// La marca que deja una fila al abrirse: cuál era y a qué hora. La hora es la que
// distingue "acabo de volver" de "esta marca quedó del viernes".
//
// Se probó además contar los saltos (una vuelta del detalle son dos cambios de
// pantalla) y se quitó: de una orden se sale a Editar y a Imprimir, y volver de ahí son
// cuatro, así que el freno le pegaba justo al camino más común de Proveeduría. La hora
// alcanza: lo que se quiere impedir es heredar lo del viernes, no lo de hace un minuto.
export type MarcaFila = { id: string; t: number };

// Tolerante a propósito: en sessionStorage puede haber quedado la marca de una versión
// anterior (el id pelado, sin hora) o basura de otra cosa, y eso no puede tumbar la
// lista. Sin hora la marca todavía sirve para volver a la fila; para heredar la
// búsqueda no, y por eso queda con t = 0 (vencida).
export function leerMarcaFila(raw: string | null): MarcaFila | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    if (m && typeof m === "object" && typeof m.id === "string" && typeof m.t === "number" && Number.isFinite(m.t)) {
      return { id: m.id, t: m.t };
    }
  } catch { /* no era JSON: es el id pelado de la versión anterior */ }
  return { id: raw, t: 0 };
}

export const escribirMarcaFila = (id: string, ahora: number): string => JSON.stringify({ id, t: ahora });

// Lo poco que se le pregunta al estado guardado para decidir: en qué visita se escribió
// y a qué hora.
export type EstadoGuardado = { visita?: number; t?: number };

// Escrito hace poco. El reloj hacia atrás (cambio de hora, máquina que se sincroniza)
// cuenta como vencido: abrir la lista completa nunca esconde trabajo.
const fresca = (t: number | undefined, ahora: number, ventana: number = VENTANA_BUSQUEDA_MS): boolean =>
  typeof t === "number" && Number.isFinite(t) && t <= ahora && ahora - t < ventana;

// ¿Se conserva lo que se estaba buscando, o la lista abre completa?
export function conservaBusqueda(a: { guardado: EstadoGuardado; marca: MarcaFila | null; visita: number; ahora: number }): boolean {
  // Volver de un detalle abierto desde esta misma tabla, hace un rato. La marca se
  // consume al volver, así que vale una sola vez.
  if (a.marca && fresca(a.marca.t, a.ahora)) return true;
  // Seguir en la misma visita a la pantalla, hace un rato: alternar Lista / Por
  // proveedor, tocar un panel de arriba (la lista remonta), recargar con F5.
  return a.guardado.visita === a.visita && fresca(a.guardado.t, a.ahora);
}

// LOS FILTROS DE LA PANTALLA (los paneles de arriba, "Solo mis órdenes") se guardan
// igual y por lo mismo: volver de un detalle tiene que devolver la pantalla como estaba.
// La jornada, y no la media hora de la búsqueda: el panel elegido se VE —el recuadro
// queda encendido, el rótulo dice "Órdenes lanzadas" y al lado hay "Ver todas"—, así que
// esconde mucho menos que una barra de búsqueda que uno ya no está mirando. Lo que se
// quiere cortar es el filtro que cruza la noche o el fin de semana.
export const VENTANA_PANTALLA_MS = 4 * 60 * 60 * 1000;   // una jornada de trabajo

export type FiltroGuardado<T> = { v: T; t: number };

export function leerFiltro<T extends string>(raw: string | null, ahora: number, valido?: (v: string) => boolean): T | null {
  if (!raw) return null;
  let v: string | null = null;
  let t = 0;
  try {
    const g = JSON.parse(raw);
    if (g && typeof g === "object" && typeof g.v === "string" && typeof g.t === "number") { v = g.v; t = g.t; }
  } catch { /* valor pelado de la versión anterior: vencido */ }
  if (v === null || !fresca(t, ahora, VENTANA_PANTALLA_MS)) return null;
  if (valido && !valido(v)) return null;   // un filtro que ya no existe dejaba la tabla vacía sin nada que tocar
  return v as T;
}

export const escribirFiltro = <T extends string>(v: T, ahora: number): string => JSON.stringify({ v, t: ahora });
