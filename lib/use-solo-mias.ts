import { useFiltroPantalla } from "./use-filtro-pantalla";

// Toggle "Solo mis órdenes" (compara Orden.creadoPor con el usuario de la sesión).
// La elección se recuerda por sesión y se COMPARTE entre las vistas Por orden y
// Por línea (misma clave): si filtrás a las tuyas y cambiás de vista, te sigue.
// Como todo lo que esconde filas, vence si la pantalla se dejó de usar un rato largo
// (ver `lib/use-filtro-pantalla.ts`).
const CLAVE = "adelante_oc_ordenes_solo_mias";

export function useSoloMias(): [boolean, (v: boolean) => void] {
  const [v, elegir] = useFiltroPantalla<"1" | "0">(CLAVE, "0", (x) => x === "1" || x === "0");
  return [v === "1", (b: boolean) => elegir(b ? "1" : "0")];
}
