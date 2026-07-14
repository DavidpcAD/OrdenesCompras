// Íconos de la app = íconos del Adelante Design System (react/Icon/Icon.tsx).
// Todos los paths salen de ICON_PATHS (ds-icon.tsx), rellenos, viewBox 24×24.
// Cada export mapea al ícono del DS más cercano. Los chevrons son la única
// excepción (el DS no tiene chevron plano) y van en trazo, como afordancia de UI.
import React from "react";
import { ICON_PATHS } from "./ds-icon";

type P = { size?: number } & React.SVGProps<SVGSVGElement>;

// Fábrica: ícono del DS por nombre, con tamaño px configurable.
function ds(name: string, dflt = 20) {
  const Cmp = ({ size = dflt, ...p }: P) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...p}>
      {ICON_PATHS[name] && <path d={ICON_PATHS[name]} fillRule={name === "checkbox-fill" ? "evenodd" : undefined} />}
    </svg>
  );
  Cmp.displayName = `Icon(${name})`;
  return Cmp;
}

export const IconReceipt = ds("boleta", 22);   // órdenes / documentos
export const IconWrench = ds("options", 22);    // repuesto (sin equivalente exacto)
export const IconBox = ds("entrega", 22);       // material
export const IconTrash = ds("delete", 18);
export const IconWarning = ds("alert", 20);
export const IconClose = ds("close", 18);
export const IconCheck = ds("check", 18);
export const IconEye = ds("open", 16);          // ver detalle
export const IconBell = ds("alert", 20);        // notificaciones
export const IconLogout = ds("back", 18);       // salir
export const IconList = ds("list", 18);
export const IconOptions = ds("options", 18);
export const IconDuplicate = ds("duplicar", 18);
export const IconMatrix = ds("calculator", 18); // Matriz
export const IconTrack = ds("place", 18);       // seguimiento (ubicación)
export const IconDelivery = ds("entrega", 18);
export const IconFolder = ds("folder", 18);
export const IconPlus = ds("plus", 18);
export const IconTable = ds("list", 16);        // vista tabla
export const IconGrid = ds("cuadrillas", 16);   // vista grid

// Chevrons: el DS no tiene chevron plano → trazo mínimo (afordancia de UI).
export const IconChevronDown = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconChevronLeft = ds("back", 18);
