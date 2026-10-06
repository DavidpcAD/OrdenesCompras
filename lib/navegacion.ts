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

// `previa` es la pantalla de la que se VIENE. Se guarda acá y no se deduce leyendo el
// registro al montar: el AppShell lo anota en un efecto, y quien quiera saber de dónde
// viene estaría compitiendo con ese efecto. Guardado, se puede preguntar en cualquier
// momento (en el clic, por ejemplo), que es cuando ya no hay carrera.
export type RegistroNav = { n: number; ruta: string | null; previa: string | null };

const VACIO: RegistroNav = { n: 0, ruta: null, previa: null };

// Tolerante a propósito: en sessionStorage puede haber quedado basura de una versión
// anterior de la app, y eso no puede tumbar la navegación.
export function leerNav(raw: string | null): RegistroNav {
  try {
    const r = JSON.parse(raw ?? "null");
    if (r && typeof r.n === "number" && Number.isFinite(r.n) && r.n >= 0) {
      return {
        n: r.n,
        ruta: typeof r.ruta === "string" ? r.ruta : null,
        // Puede no venir: lo guardado por una versión anterior de la app no la traía.
        previa: typeof r.previa === "string" ? r.previa : null,
      };
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
  return { n: previo.ruta === null ? 0 : previo.n + 1, ruta, previa: previo.ruta };
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

// EN QUÉ VISITA ESTÁ UNA PANTALLA QUE SE ACABA DE PINTAR. El AppShell anota el cambio
// de ruta en un efecto, y los efectos corren de adentro hacia afuera: cuando la tabla
// de la pantalla nueva se pinta, el registro todavía trae la pantalla anterior y
// `visitaActual()` contesta el número viejo. La tabla creía entonces seguir en la
// visita de antes y se traía su búsqueda. Esto contesta el número que la pantalla VA a
// tener, sin adelantar la anotación: mover la anotación al render arreglaba la tabla
// pero le mentía al botón Volver (un `router.replace` sube el contador sin agregar
// entrada al historial, y "Volver" terminaba haciendo back() sin a dónde volver).
export function visitaTras(previo: RegistroNav, ruta: string): number {
  const sig = siguienteNav(previo, ruta);
  return sig ? sig.n : previo.n;
}

export const visitaDe = (ruta: string): number => visitaTras(registroNav(), ruta);

// CÓMO SALIR DE UNA PANTALLA DE PASO (editar una orden, armarla) hacia `destino`, sin
// dejarla atrás en el historial. Si se entró DESDE el destino —lo normal: la orden →
// Editar— salir es un `back()`: la entrada de Editar se descarta y el "Volver" de la
// orden sigue llevando a la lista de donde se venía. Si se entró de otro lado (desde
// la solicitud, o por un link directo) se reemplaza la entrada actual: lleva al mismo
// destino y tampoco deja la pantalla de paso detrás.
//
// Lo que no puede pasar es un `push`: ahí Editar queda DETRÁS de la orden y "Volver"
// cae de vuelta en Editar, que para entonces ya contesta "No se puede editar" (la
// orden recién guardada ya no está Abierta).
export function modoSalida(reg: RegistroNav, actual: string, destino: string): "back" | "replace" {
  // De dónde venimos. Si el registro ya anotó la pantalla en la que estamos, la
  // anterior es su `previa`; si todavía no alcanzó a anotarla (se preguntó demasiado
  // pronto), la anterior es la que el registro trae como actual.
  const anterior = reg.ruta === actual ? reg.previa : reg.ruta;
  return anterior !== null && anterior === destino.split("?")[0] ? "back" : "replace";
}
