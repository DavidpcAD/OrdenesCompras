"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hayNavegacionInterna } from "@/lib/navegacion";

// "Volver" tiene que devolver a la pantalla ANTERIOR, no a una ruta fija. Si entré a
// una orden desde Solicitudes, volver me deja en Solicitudes — y con su filtro, su
// scroll y su página, porque es la MISMA entrada del historial, no una nueva.
//
// Solo usa el historial si sabemos que la pantalla anterior es de la app (lo dice el
// registro de navegación de la pestaña, que lleva el AppShell). Si se entró por link
// directo (correo, WhatsApp), cae a la ruta de siempre: un `back()` ahí te sacaría del
// sistema.
//
// Devuelve también el RÓTULO, porque el botón no puede prometer un destino que no va
// a cumplir: si vuelve por el historial dice "Volver" a secas, no "Volver a X".
export function useVolver(fallback: string, etiquetaFallback = "Volver") {
  const router = useRouter();
  const [interna, setInterna] = useState(false);
  // Después del montaje: leer sessionStorage durante el render rompe la hidratación.
  useEffect(() => { setInterna(hayNavegacionInterna()); }, []);
  const volver = () => { if (interna) router.back(); else router.push(fallback); };
  return { volver, etiqueta: interna ? "Volver" : etiquetaFallback };
}
