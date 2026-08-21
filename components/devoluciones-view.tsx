"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { destinoLabel, devolucionesDeRol, formatDate, numeroOrden } from "@/lib/helpers";
import type { Role } from "@/lib/types";

type Dev = { id: string; tipo: "Solicitud" | "Orden"; numero: string; contra: string; motivo: string; fecha: string; href: string };

// Bandeja de devoluciones, compartida por todos los roles. Reúne:
//  • Solicitudes que Proveeduría devolvió a Ingeniería (pedido.estado = "devuelto")
//  • Órdenes que Aprobación rechazó a Proveeduría (orden.estado = "rechazado")
// Cada rol ve las que le competen y entra a corregirlas.
export function DevolucionesView({ role }: { role: Role }) {
  const { pedidos, ordenes, proveedores } = useStore();
  const router = useRouter();

  const items = useMemo<Dev[]>(() => {
    const out: Dev[] = [];
    // Qué le toca a cada rol: misma regla que el punto rojo del menú.
    const { solicitudes: devSolicitudes, ordenes: devOrdenes } = devolucionesDeRol(role, pedidos, ordenes);
    for (const p of devSolicitudes) {
      out.push({
        id: p.id, tipo: "Solicitud", numero: p.numero, contra: destinoLabel(p),
        motivo: (p.notas ?? "").replace(/^↩\s*Devuelto:\s*/i, "").split(" · ")[0] || "—",
        fecha: p.fecha, href: `/proveeduria/solicitudes/${p.id}`,
      });
    }
    for (const o of devOrdenes) {
      // El proveedor puede venir en la orden (SQL) o solo como id: se resuelve
      // contra el catálogo igual que en el detalle, para no mostrar "—".
      const prov = proveedores.find((p) => p.id === o.proveedorId);
      out.push({
        id: o.id, tipo: "Orden", numero: numeroOrden(o), contra: o.proveedorNombre ?? prov?.nombre ?? o.proveedorNo ?? prov?.code ?? "—",
        motivo: o.motivoRechazo ?? "—", fecha: o.fecha,
        href: role === "proveeduria" ? `/proveeduria/ordenes/${o.id}` : "",
      });
    }
    return out;
  }, [pedidos, ordenes, proveedores, role]);

  const columns = useMemo<ColumnDef<Dev, any>[]>(() => [
    { id: "tipo", header: "Tipo", accessorFn: (d) => d.tipo, meta: { label: "Tipo" }, cell: (c) => <Badge tone={c.getValue() === "Orden" ? "red" : "yellow"}>{c.getValue()}</Badge> },
    { id: "numero", header: "N.º", accessorFn: (d) => d.numero, meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "contra", header: "Proveedor / Destino", accessorFn: (d) => d.contra, meta: { label: "Proveedor / Destino" } },
    { id: "motivo", header: "Motivo", accessorFn: (d) => d.motivo, meta: { label: "Motivo" }, cell: (c) => <span className="ds-muted">{c.getValue()}</span> },
    { id: "fecha", header: "Fecha", accessorFn: (d) => d.fecha, meta: { label: "Fecha", date: true }, cell: (c) => formatDate(c.getValue()) },
  ], []);

  const desc = role === "proveeduria" ? "Órdenes que Aprobación rechazó (corregí y relanzá) y solicitudes que devolviste a Ingeniería."
    : "Órdenes rechazadas por Aprobación (solo lectura).";

  return (
    <>
      <main className="page page--wide">
        <div className="page__head"><div className="page__title">
          <h1 className="ds-heading">Devoluciones</h1>
          <p className="ds-muted">{desc}</p>
        </div></div>
        <div className="mt-4">
          <DataTable data={items} columns={columns} tablaKey={`devoluciones-${role}`} titulo="Devoluciones" buscarPlaceholder="Buscar por material, orden o proveedor…"
            getRowId={(d) => `${d.tipo}-${d.id}`} onRowClick={(d) => { if (d.href) router.push(d.href); }}
            vacio="No hay devoluciones pendientes." />
        </div>
      </main>
    </>
  );
}
