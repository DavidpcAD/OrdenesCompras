"use client";

import { useEffect, useState } from "react";
import { escribirFiltro, leerFiltro } from "./memoria-tabla";

// EL FILTRO DE LA PANTALLA: el panel que se toca arriba (Abiertas, Lanzadas…), "Solo
// mis órdenes". Se recuerda por pestaña y por la misma razón que la búsqueda de la
// tabla: entrar a una orden y volver tiene que devolver la pantalla como estaba.
//
// Y con un límite. Un panel elegido el viernes no puede seguir mandando el lunes —sale
// una lista corta sin decir por qué—, así que lo guardado trae su hora y vence a las
// cuatro horas: la jornada, no la media hora de la búsqueda, porque el panel se VE (el
// recuadro encendido, el rótulo, el "Ver todas" al lado). La hora se renueva al entrar a
// la pantalla y al elegir; lo que se corta es el filtro que cruzó la noche.
// Devuelve [valor, elegir (guarda), poner (no guarda)]. El tercero es para las pantallas
// que remontan la lista con `key={filtro}`: ahí guardar el panel haría montar dos veces
// (ver el comentario de app/proveeduria/ordenes/page.tsx).
export function useFiltroPantalla<T extends string>(
  clave: string,
  inicial: T,
  valido?: (v: string) => boolean,
): [T, (v: T) => void, (v: T) => void] {
  const [filtro, setFiltro] = useState<T>(inicial);
  // Se lee después del montaje y no en el `useState` inicial: leer sessionStorage
  // durante el render desincroniza la hidratación de Next (el server pinta sin filtro).
  useEffect(() => {
    try {
      const v = leerFiltro<T>(sessionStorage.getItem(clave), Date.now(), valido);
      if (v === null) return;
      setFiltro(v);
      sessionStorage.setItem(clave, escribirFiltro(v, Date.now()));
    } catch { /* sin sessionStorage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const elegir = (v: T) => {
    setFiltro(v);
    try { sessionStorage.setItem(clave, escribirFiltro(v, Date.now())); } catch { /* noop */ }
  };
  return [filtro, elegir, setFiltro];
}
