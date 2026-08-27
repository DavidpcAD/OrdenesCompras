import { useEffect, useState } from "react";

// Toggle "Solo mis órdenes" (compara Orden.creadoPor con el usuario de la sesión).
// La elección se recuerda por sesión y se COMPARTE entre las vistas Por orden y
// Por línea (misma clave): si filtrás a las tuyas y cambiás de vista, te sigue.
const CLAVE = "adelante_oc_ordenes_solo_mias";

export function useSoloMias(): [boolean, (v: boolean) => void] {
  const [soloMias, setSoloMias] = useState(false);
  // Se lee en un efecto (no en el useState inicial) para no desincronizar la
  // hidratación de Next: el server siempre pinta "sin filtrar".
  useEffect(() => {
    try { if (sessionStorage.getItem(CLAVE) === "1") setSoloMias(true); } catch { /* sin sessionStorage */ }
  }, []);
  const elegir = (v: boolean) => {
    setSoloMias(v);
    try { sessionStorage.setItem(CLAVE, v ? "1" : "0"); } catch { /* noop */ }
  };
  return [soloMias, elegir];
}
