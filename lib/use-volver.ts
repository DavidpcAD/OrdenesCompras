"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// El AppShell la pone en "1" en cuanto hay una navegación DENTRO de la app. Vive en
// sessionStorage (por pestaña): abrir un link directo en una pestaña nueva arranca
// limpio, así que ahí "volver" no puede sacarte de la app.
export const CLAVE_NAV_INTERNA = "adelante_oc_nav_interna";

// "Volver" tiene que devolver a la pantalla ANTERIOR, no a una ruta fija. Si entré a
// una orden desde Solicitudes, volver me deja en Solicitudes — y con su filtro, su
// scroll y su página, porque es la MISMA entrada del historial, no una nueva.
//
// Solo usa el historial si sabemos que la pantalla anterior es de la app. Si se entró
// por link directo (correo, WhatsApp), cae a la ruta de siempre: un `back()` ahí te
// sacaría del sistema.
//
// Devuelve también el RÓTULO, porque el botón no puede prometer un destino que no va
// a cumplir: si vuelve por el historial dice "Volver" a secas, no "Volver a X".
export function useVolver(fallback: string, etiquetaFallback = "Volver") {
  const router = useRouter();
  const [interna, setInterna] = useState(false);
  useEffect(() => {
    try { setInterna(sessionStorage.getItem(CLAVE_NAV_INTERNA) === "1"); } catch { /* sin sessionStorage */ }
  }, []);
  const volver = () => { if (interna) router.back(); else router.push(fallback); };
  return { volver, etiqueta: interna ? "Volver" : etiquetaFallback };
}
