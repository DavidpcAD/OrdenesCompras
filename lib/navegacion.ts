// EL REGISTRO DE NAVEGACIÓN DE LA PESTAÑA: en qué pantalla estamos parados y cuántas
// veces se cambió de pantalla desde que se abrió la pestaña. Lo escribe el AppShell en
// cada cambio de ruta y vive en sessionStorage (por pestaña): abrir un link directo en
// una pestaña nueva arranca limpio.
//
// Existe para contestar dos preguntas distintas que antes nadie podía contestar:
//
//   · "¿ya hubo alguna navegación DENTRO de la app?" — la usa el botón Volver para
//     saber si puede usar el historial sin riesgo de sacar a alguien del sistema.
//   · "¿sigo en la MISMA visita a esta pantalla?" — la usan las tablas para saber si
//     lo que alguien estaba buscando hace un rato todavía es lo que quiere ver.
//
// El contador no pretende ser exacto: lo único que se le pide es que dos lecturas con
// el mismo número signifiquen "no me moví de pantalla entre una y otra".

export const CLAVE_NAV = "adelante_oc_nav";

export type RegistroNav = { n: number; ruta: string | null };

const VACIO: RegistroNav = { n: 0, ruta: null };

// Tolerante a propósito: en sessionStorage puede haber quedado basura de una versión
// anterior de la app, y eso no puede tumbar la navegación.
export function leerNav(raw: string | null): RegistroNav {
  try {
    const r = JSON.parse(raw ?? "null");
    if (r && typeof r.n === "number" && Number.isFinite(r.n) && r.n >= 0) {
      return { n: r.n, ruta: typeof r.ruta === "string" ? r.ruta : null };
    }
  } catch { /* no era JSON: se arranca de cero */ }
  return VACIO;
}

// Qué registrar al entrar a `ruta`, o `null` si no hay nada que registrar.
// La PRIMERA pantalla de la pestaña no cuenta como navegación: si se entró por un link
// directo (un correo, un WhatsApp), el contador queda en 0 y "Volver" cae a su ruta de
// siempre en vez de sacar a la persona del sistema. Volver a pintar la MISMA ruta
// (recargar con F5) tampoco cuenta: el historial no cambió.
export function siguienteNav(previo: RegistroNav, ruta: string): RegistroNav | null {
  if (previo.ruta === ruta) return null;
  return { n: previo.ruta === null ? 0 : previo.n + 1, ruta };
}

export function registroNav(): RegistroNav {
  if (typeof window === "undefined") return VACIO;
  try { return leerNav(sessionStorage.getItem(CLAVE_NAV)); } catch { return VACIO; }
}

export function marcarNavegacion(ruta: string): void {
  if (typeof window === "undefined") return;
  const sig = siguienteNav(registroNav(), ruta);
  if (!sig) return;
  try { sessionStorage.setItem(CLAVE_NAV, JSON.stringify(sig)); } catch { /* sin sessionStorage */ }
}

// ¿Ya se navegó al menos una vez dentro de la app en esta pestaña?
export const hayNavegacionInterna = (): boolean => registroNav().n >= 1;

// El número de la visita en curso. Dos lecturas con el mismo número son la misma
// estadía en la pantalla, aunque el componente se haya desmontado y vuelto a montar.
export const visitaActual = (): number => registroNav().n;
