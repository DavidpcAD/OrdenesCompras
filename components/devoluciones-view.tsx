"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Card } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { correccionDeSolicitud, destinoLabel, devolucionesDeRol, formatDate, motivoDevolucion, numeroOrden, pedidoLineaPendiente, ordenDeDevolucion } from "@/lib/helpers";
import type { Role } from "@/lib/types";

type Dev = {
  id: string;
  tipo: "Solicitud" | "Orden";
  numero: string;
  contra: string;
  motivo: string;
  fecha: string;        // cuándo se devolvió / rechazó
  que: string;          // qué se devolvió (líneas) o qué queda por ordenar
  estado: string;       // "Esperando al ingeniero" | "Corregida …" | "Rechazada"
  href: string;
};

// Bandeja de devoluciones, compartida por todos los roles. Reúne:
//  • Solicitudes que Proveeduría devolvió a Ingeniería, enteras (pedido.estado =
//    "devuelto") o por línea (alguna línea con devuelta = true)
//  • Órdenes que Aprobación rechazó a Proveeduría (orden.estado = "rechazado")
//
// Va en DOS grupos, y esa es la razón de ser de esta pantalla: antes, cuando el
// ingeniero corregía lo que se le devolvió, la solicitud simplemente DESAPARECÍA de
// acá y nadie avisaba. La señal de "ya está lista" era una ausencia, y había que
// acordarse de que existía. Ahora lo corregido sube arriba, con fecha y quién.
export function DevolucionesView({ role }: { role: Role }) {
  const { pedidos, ordenes, proveedores } = useStore();
  const router = useRouter();

  const { corregidas, esperando } = useMemo(() => {
    const d = devolucionesDeRol(role, pedidos, ordenes);

    // Qué queda por ordenar de la solicitud corregida: es lo que hay que hacer con
    // ella. Siempre hay al menos una línea con saldo — sin saldo la solicitud ya no
    // cuenta como corregida (ver estadoDeDevolucion), justamente para que salga de
    // acá cuando se ordene.
    const pendienteDe = (p: (typeof pedidos)[number]) => {
      const ls = p.lineas.filter((l) => pedidoLineaPendiente(l) > 0);
      const primera = ls.length ? `${ls[0].descripcion}${ls[0].variantCode ? ` · var. ${ls[0].variantCode}` : ""}` : "—";
      return ls.length > 1 ? `${primera} +${ls.length - 1} más` : primera;
    };

    const solicitudCorregida = (p: (typeof pedidos)[number]): Dev => {
      const { fecha, quien } = correccionDeSolicitud(p);
      // Si el material salió de una orden que sigue viva, la bandeja lleva DIRECTO a
      // esa orden (a editarla, con el material corregido ya puesto): es lo que hay que
      // hacer con esta fila, y pasar por la solicitud era un salto de más.
      const origen = role === "proveeduria" ? ordenDeDevolucion(ordenes, p) : null;
      return {
        id: p.id, tipo: "Solicitud", numero: p.numero,
        motivo: motivoDevolucion(p.notas),
        fecha: p.devolucion?.fecha ?? p.fecha,
        que: pendienteDe(p),
        // Sin la edición en la bitácora igual se sabe que está corregida (la línea ya
        // no está marcada), pero no la fecha: se dice lo que se sabe.
        estado: fecha ? `Corregida ${formatDate(fecha)}${quien ? ` · ${quien}` : ""}` : "Corregida",
        // El destino de la fila: seguir con la orden de la que salió, o —si no salió
        // de ninguna orden viva— la solicitud, para armarle una.
        href: origen ? `/proveeduria/ordenes/${origen.id}/editar` : `/proveeduria/solicitudes/${p.id}`,
        contra: origen ? `${destinoLabel(p)} · sigue en ${numeroOrden(origen)}` : destinoLabel(p),
      };
    };

    const solicitudEsperando = (p: (typeof pedidos)[number]): Dev => ({
      id: p.id, tipo: "Solicitud", numero: p.numero, contra: destinoLabel(p),
      motivo: motivoDevolucion(p.notas),
      fecha: p.devolucion?.fecha ?? p.fecha,
      que: p.devolucion?.lineas || (p.estado === "devuelto" ? "Solicitud completa" : p.lineas.filter((l) => l.devuelta).map((l) => l.descripcion).join("; ") || "—"),
      estado: "Esperando al ingeniero",
      href: `/proveeduria/solicitudes/${p.id}`,
    });

    const ordenRechazada = (o: (typeof ordenes)[number]): Dev => {
      // El proveedor puede venir en la orden (SQL) o solo como id: se resuelve
      // contra el catálogo igual que en el detalle, para no mostrar "—".
      const prov = proveedores.find((p) => p.id === o.proveedorId);
      return {
        id: o.id, tipo: "Orden", numero: numeroOrden(o),
        contra: o.proveedorNombre ?? prov?.nombre ?? o.proveedorNo ?? prov?.code ?? "—",
        motivo: o.motivoRechazo ?? "—", fecha: o.fecha,
        que: `${o.lineas.filter((l) => l.tipo === "articulo").length} línea(s)`,
        estado: "Rechazada por Aprobación",
        href: role === "proveeduria" ? `/proveeduria/ordenes/${o.id}` : "",
      };
    };

    return {
      // Las órdenes rechazadas van con lo accionable: también hay que corregirlas.
      corregidas: [...d.corregidas.map(solicitudCorregida), ...d.ordenes.map(ordenRechazada)],
      esperando: d.esperando.map(solicitudEsperando),
    };
  }, [pedidos, ordenes, proveedores, role]);

  const columnas = (conEstado: boolean): ColumnDef<Dev, any>[] => [
    { id: "tipo", header: "Tipo", accessorFn: (d) => d.tipo, meta: { label: "Tipo" }, cell: (c) => <Badge tone={c.getValue() === "Orden" ? "red" : "yellow"}>{c.getValue()}</Badge> },
    { id: "numero", header: "N.º", accessorFn: (d) => d.numero, meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "contra", header: "Proveedor / Destino", accessorFn: (d) => d.contra, meta: { label: "Proveedor / Destino" } },
    { id: "que", header: conEstado ? "Por ordenar" : "Qué se devolvió", accessorFn: (d) => d.que, meta: { label: conEstado ? "Por ordenar" : "Qué se devolvió" },
      cell: (c) => <span className="ds-clamp-2" style={{ maxWidth: 320 }}>{c.getValue()}</span> },
    { id: "motivo", header: "Motivo", accessorFn: (d) => d.motivo, meta: { label: "Motivo" }, cell: (c) => <span className="ds-muted ds-clamp-2" style={{ maxWidth: 280 }}>{c.getValue()}</span> },
    { id: "fecha", header: "Devuelta", accessorFn: (d) => d.fecha, meta: { label: "Devuelta", date: true }, cell: (c) => formatDate(c.getValue()) },
    ...(conEstado ? [{
      id: "estado", header: "Estado", accessorFn: (d: Dev) => d.estado, meta: { label: "Estado" },
      cell: (c: any) => <span className="ds-strong ds-body-sm" style={{ color: "var(--ds-color-green-200)" }}>{c.getValue()}</span>,
    } as ColumnDef<Dev, any>] : []),
  ];

  const desc = role === "proveeduria"
    ? "Lo que volvió corregido y hay que ordenar, y lo que sigue en manos del ingeniero."
    : "Órdenes rechazadas por Aprobación (solo lectura).";

  return (
    <>
      <main className="page page--wide">
        <div className="page__head"><div className="page__title">
          <h1 className="ds-heading">Devoluciones</h1>
          <p className="ds-muted">{desc}</p>
        </div></div>

        {/* Arriba lo que hay que ATENDER: solicitudes que el ingeniero ya corrigió y
            órdenes que Aprobación rechazó. Es lo que cuenta el punto rojo del menú. */}
        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row row--between wrap gap-3" style={{ alignItems: "center", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 8%, var(--ds-tint-base))" }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="ds-strong ds-body-sm">Listas para ordenar{corregidas.length ? ` (${corregidas.length})` : ""}</span>
              <span className="ds-muted ds-body-sm">Solicitudes que el ingeniero ya corrigió y órdenes rechazadas por corregir. Entrá a cada una.</span>
            </div>
          </div>
          <DataTable data={corregidas} columns={columnas(true)} tablaKey={`devoluciones-listas-${role}`} titulo="Devoluciones listas para ordenar"
            buscarPlaceholder="Buscar por material, orden o proveedor…"
            getRowId={(d) => `${d.tipo}-${d.id}`} onRowClick={(d) => { if (d.href) router.push(d.href); }}
            vacio="Nada corregido por ahora. Cuando el ingeniero arregle una solicitud devuelta, aparece acá." />
        </Card>

        {/* Y abajo lo que está esperando del otro lado: informativo, sin nada que
            hacer todavía (por eso no cuenta en el punto rojo del menú). */}
        {role === "proveeduria" && (
          <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
            <div className="row row--between wrap gap-3" style={{ alignItems: "center", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
              <div className="col" style={{ gap: 2 }}>
                <span className="ds-strong ds-body-sm">Esperando al ingeniero{esperando.length ? ` (${esperando.length})` : ""}</span>
                <span className="ds-muted ds-body-sm">Devueltas a Producción. Todavía no se pueden ordenar: la línea queda bloqueada hasta que la corrijan.</span>
              </div>
            </div>
            <DataTable data={esperando} columns={columnas(false)} tablaKey={`devoluciones-esperando-${role}`} titulo="Devoluciones esperando al ingeniero"
              buscarPlaceholder="Buscar por material o solicitud…"
              getRowId={(d) => `esp-${d.id}`} onRowClick={(d) => { if (d.href) router.push(d.href); }}
              vacio="No hay nada devuelto esperando corrección." />
          </Card>
        )}
      </main>
    </>
  );
}
