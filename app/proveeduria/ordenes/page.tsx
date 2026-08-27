"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Tile } from "@/components/ui";
import { OrdenesLista } from "@/components/ordenes-lista";
import { VistaToggle } from "@/components/vista-toggle";
import { IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";

type Filtro = "todas" | "abierto" | "rechazado" | "lanzado" | "completado";

export default function OrdenesPage() {
  const { ordenes, pedidos } = useStore();
  const router = useRouter();
  // El recuadro elegido arriba es un filtro más: se recuerda por sesión, así que
  // volver de un detalle te deja la pantalla como estaba.
  const CLAVE_FILTRO = "adelante_oc_kpi_ordenes-prov";
  const [filtro, setFiltro] = useState<Filtro>("todas");
  useEffect(() => {
    try { const v = sessionStorage.getItem(CLAVE_FILTRO); if (v) setFiltro(v as Filtro); } catch { /* sin sessionStorage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const elegirFiltro = (f: Filtro) => { setFiltro(f); try { sessionStorage.setItem(CLAVE_FILTRO, f); } catch { /* noop */ } };
  const listaRef = useRef<HTMLDivElement>(null);

  function seleccionar(f: Filtro) {
    setFiltro(f);
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  const abiertas = ordenes.filter((o) => o.estado === "abierto").length;
  const rechazadas = ordenes.filter((o) => o.estado === "rechazado").length;
  const lanzadas = ordenes.filter((o) => o.estado === "lanzado").length;
  const completas = ordenes.filter((o) => o.estado === "completado").length;

  const lista = ordenes.filter((o) => (filtro === "todas" ? true : o.estado === filtro));
  const etiqueta: Record<Filtro, string> = {
    todas: "Todas las órdenes",
    abierto: "Órdenes abiertas (borrador)",
    rechazado: "Órdenes rechazadas (corregir y reenviar)",
    lanzado: "Órdenes lanzadas",
    completado: "Órdenes completadas",
  };

  return (
    <>
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes de compra</h1>
            <p className="ds-muted">Órdenes enviadas a proveedores. Tocá un panel para filtrar. Quedan abiertas hasta recibir el 100% del material.</p>
          </div>
          <Button onClick={() => router.push("/proveeduria/directa")}>+ Nueva orden directa</Button>
        </div>

        <VistaToggle opciones={[
          { label: "Por orden", href: "/proveeduria/ordenes", active: true, icon: <IconReceipt size={16} /> },
          { label: "Por línea", href: "/proveeduria/pedidas", active: false, icon: <IconList size={16} /> },
        ]} />

        <div className="tiles mt-2">
          <Tile value={ordenes.length} label="Órdenes totales" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
          <Tile value={abiertas} label="Abiertas (borrador)" accent="var(--ds-color-gray-300)" onClick={() => seleccionar("abierto")} active={filtro === "abierto"} />
          <Tile value={rechazadas} label="Rechazadas" accent="var(--ds-color-red-200)" onClick={() => seleccionar("rechazado")} active={filtro === "rechazado"} />
          <Tile value={lanzadas} label="Lanzadas" accent="var(--ds-color-green-100)" onClick={() => seleccionar("lanzado")} active={filtro === "lanzado"} />
          <Tile value={completas} label="Completadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("completado")} active={filtro === "completado"} />
        </div>

        <div ref={listaRef} className="row row--between mt-6" style={{ marginBottom: 12, alignItems: "baseline", scrollMarginTop: 80 }}>
          <span className="ds-label ds-muted">{etiqueta[filtro]}</span>
          {filtro !== "todas" && <button className="link-btn" onClick={() => elegirFiltro("todas")}>Ver todas</button>}
        </div>

        <OrdenesLista key={filtro} ordenes={lista} filtroMias hrefDetalle={(id) => `/proveeduria/ordenes/${id}`}
          // El N.º de solicitud abre esa solicitud (el enlace va en los dos sentidos:
          // desde Solicitudes se abre la orden, y desde acá la solicitud).
          pedidoHref={(n) => { const p = pedidos.find((x) => x.numero === n); return p ? `/proveeduria/solicitudes/${p.id}` : null; }}
          vacio="No hay órdenes en esta categoría." />
      </main>
    </>
  );
}
