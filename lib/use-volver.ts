"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hayNavegacionInterna, modoSalida, registroNav } from "@/lib/navegacion";

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

// SALIR DE UNA PANTALLA DE PASO hacia `href` sin dejarla en el historial. Es el gemelo
// de `useVolver`: aquel decide a dónde va el botón Volver, este decide cómo se sale de
// una pantalla por la que no se vuelve a pasar (ver `modoSalida`).
//
// El caso que lo trajo: editar una orden, guardar, y que el "Volver" de la orden
// cayera en "No se puede editar" — la pantalla de Editar había quedado detrás.
export function useSalida(href: string) {
  const router = useRouter();
  const pathname = usePathname();
  // El registro se lee AL SALIR, no al montar: al montar todavía está corriendo el
  // efecto del AppShell que anota la pantalla, y leerlo ahí es una carrera (se perdía,
  // y la salida terminaba siempre en `replace`). Para cuando alguien le da al botón,
  // el registro ya sabe dónde estamos y de dónde venimos.
  return () => {
    if (modoSalida(registroNav(), pathname, href) === "back") router.back();
    else router.replace(href);
  };
}
