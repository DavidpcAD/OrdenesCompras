"use client";

import { useRef } from "react";
import { FiltroChip } from "@/components/ui";
import { OrdenesLista } from "@/components/ordenes-lista";
import { useStore } from "@/lib/store";
import { useFiltroPantalla } from "@/lib/use-filtro-pantalla";
import { ordenEsperaCorreccion } from "@/lib/helpers";

// La pestaña "Órdenes" de Compras: las órdenes enviadas a proveedores. Era
// `app/proveeduria/ordenes/page.tsx`; lo que cambió al mudarse es que los recuadros
// grandes son chips y que el "Ver por: Orden / Línea" lo dibuja la pantalla.

// "espera" no es un estado de la orden en la base: es la orden que se quedó SIN
// material porque todo volvió al ingeniero y que conserva su N.º de BC. Se filtra como
// un chip más porque es donde hay trabajo detenido esperando a otra persona, y sin
// esto se leía como una Abierta cualquiera en ₡0 (o, peor, se perdía de vista).
type Filtro = "todas" | "abierto" | "espera" | "pendiente_aprobacion" | "rechazado" | "lanzado" | "completado";
const PANELES: Filtro[] = ["todas", "abierto", "espera", "pendiente_aprobacion", "rechazado", "lanzado", "completado"];

export function ComprasOrdenes() {
  const { ordenes, pedidos } = useStore();
  // El chip elegido es un filtro más: se recuerda por sesión, así que volver de un
  // detalle te deja la pantalla como estaba. Y vence como los otros: un chip del
  // viernes no puede seguir puesto el lunes (ver `use-filtro-pantalla`).
  const [filtro, elegirFiltro, setFiltro] = useFiltroPantalla<Filtro>("adelante_oc_kpi_ordenes-prov", "todas", (v) => PANELES.includes(v as Filtro));
  const listaRef = useRef<HTMLDivElement>(null);

  // Tocar un chip NO se guarda, a propósito. La lista va con `key={filtro}`: si el
  // filtro se restaurara en un efecto, la pantalla montaría primero en "todas" —pintando
  // las 465 órdenes de corrido— y al cambiar el key remontaría en el guardado. Ese
  // primer montaje desechado se come la marca de la fila, y volver de una orden dejaba
  // de devolverte a la fila donde ibas. Guardar el filtro acá pide antes sacarle el key
  // a la lista, y eso es otro trabajo. (Por lo mismo, la PESTAÑA de Compras se lee de
  // la URL en el render y no en un efecto: un efecto traería el mismo doble montaje.)
  function seleccionar(f: Filtro) {
    setFiltro(f);
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  // Las que esperan corrección salen del chip de Abiertas: están abiertas, pero no
  // hay nada que hacer con ellas hasta que el ingeniero devuelva el material.
  const esperan = ordenes.filter(ordenEsperaCorreccion);
  const abiertas = ordenes.filter((o) => o.estado === "abierto" && !ordenEsperaCorreccion(o)).length;
  // Las que ya están en BC esperando que Aprobación las lance.
  const pendientes = ordenes.filter((o) => o.estado === "pendiente_aprobacion").length;
  const rechazadas = ordenes.filter((o) => o.estado === "rechazado").length;
  const lanzadas = ordenes.filter((o) => o.estado === "lanzado").length;
  const completas = ordenes.filter((o) => o.estado === "completado").length;

  const lista = ordenes.filter((o) => {
    if (filtro === "todas") return true;
    if (filtro === "espera") return ordenEsperaCorreccion(o);
    if (filtro === "abierto") return o.estado === "abierto" && !ordenEsperaCorreccion(o);
    return o.estado === filtro;
  });
  const etiqueta: Record<Filtro, string> = {
    todas: "Todas las órdenes",
    abierto: "Órdenes abiertas (borrador)",
    espera: "Órdenes esperando la corrección del ingeniero",
    pendiente_aprobacion: "Órdenes pendientes de aprobación (ya están en Business Central, esperando que Aprobación las lance)",
    rechazado: "Órdenes rechazadas (corregir y reenviar)",
    lanzado: "Órdenes lanzadas",
    completado: "Órdenes completadas",
  };

  return (
    <>
      <div className="filtros">
        <FiltroChip value={ordenes.length} label="Todas" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
        <FiltroChip value={abiertas} label="Abiertas (borrador)" accent="var(--ds-color-gray-300)" onClick={() => seleccionar("abierto")} active={filtro === "abierto"} />
        {/* Solo si hay: un chip en 0 permanente es ruido. */}
        {esperan.length > 0 && (
          <FiltroChip value={esperan.length} label="Esperando corrección" accent="var(--ds-color-yellow)" onClick={() => seleccionar("espera")} active={filtro === "espera"} />
        )}
        <FiltroChip value={pendientes} label="Pendientes de aprobación" accent="var(--ds-color-yellow)" onClick={() => seleccionar("pendiente_aprobacion")} active={filtro === "pendiente_aprobacion"} />
        <FiltroChip value={rechazadas} label="Rechazadas" accent="var(--ds-color-red-200)" onClick={() => seleccionar("rechazado")} active={filtro === "rechazado"} />
        <FiltroChip value={lanzadas} label="Lanzadas" accent="var(--ds-color-green-100)" onClick={() => seleccionar("lanzado")} active={filtro === "lanzado"} />
        <FiltroChip value={completas} label="Completadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("completado")} active={filtro === "completado"} />
      </div>

      <div ref={listaRef} className="row row--between mt-4" style={{ marginBottom: 12, alignItems: "baseline", scrollMarginTop: 80 }}>
        <span className="ds-label ds-muted">{etiqueta[filtro]}</span>
        {filtro !== "todas" && <button className="link-btn" onClick={() => elegirFiltro("todas")}>Ver todas</button>}
      </div>

      {/* `conEnvioProveedor`: la columna "Al proveedor" (bajar el PDF + marcar que
          ya salió) es de Proveeduría; Bodega ve estas mismas listas y ahí no va. */}
      <OrdenesLista key={filtro} ordenes={lista} filtroMias conEnvioProveedor deCorrido hrefDetalle={(id) => `/proveeduria/ordenes/${id}`}
        // El N.º de solicitud abre esa solicitud (el enlace va en los dos sentidos:
        // desde Solicitudes se abre la orden, y desde acá la solicitud).
        pedidoHref={(n) => { const p = pedidos.find((x) => x.numero === n); return p ? `/proveeduria/solicitudes/${p.id}` : null; }}
        vacio="No hay órdenes en esta categoría." />
    </>
  );
}
