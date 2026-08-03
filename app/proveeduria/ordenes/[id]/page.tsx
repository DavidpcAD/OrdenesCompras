"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, EmptyState, Skeleton, useToast } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";

export default function ProvOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, pedidos, setOrdenEstado, cargando } = useStore();

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    // Durante la carga inicial (SQL/BC) el store aún está vacío: mostrar skeleton
    // en vez de parpadear "no encontrada".
    if (cargando) {
      return <main className="page"><div className="col gap-4" aria-busy="true">
        <Skeleton style={{ display: "block", width: 240, height: 30, borderRadius: 8 }} />
        <Skeleton style={{ display: "block", width: 360, height: 16, borderRadius: 6 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 340, borderRadius: 16, marginTop: 8 }} />
      </div></main>;
    }
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }
  // Link de cada línea a su solicitud de origen (para ver quién la pidió).
  const solicitudHref = (l: NonNullable<typeof orden>["lineas"][number]) => {
    const p = (l.pedidoLineaId && pedidos.find((x) => x.lineas.some((ln) => ln.id === l.pedidoLineaId)))
      || (l.pedidoNumero && pedidos.find((x) => x.numero === l.pedidoNumero));
    return p ? `/proveeduria/solicitudes/${p.id}` : null;
  };

  async function act(estado: NonNullable<typeof orden>["estado"], msg: string) {
    await setOrdenEstado(orden!.id, estado);
    toast(msg, "success");
  }

  const acciones = (
    <>
      {orden.estado === "abierto" && (
        <>
          <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/editar`)}>Editar</Button>
          <Button onClick={() => act("pendiente_aprobacion", `${orden.numero} enviada a aprobación`)}>Enviar a aprobación</Button>
        </>
      )}
      {orden.estado === "pendiente_aprobacion" && (
        <>
          <span className="ds-muted ds-label" style={{ alignSelf: "center" }}>En espera de aprobación de Luis Roberto</span>
          <Button variant="outline" onClick={() => act("abierto", "Solicitud de aprobación cancelada")}>Cancelar envío</Button>
        </>
      )}
      {orden.estado === "rechazado" && (
        <>
          <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/editar`)}>Editar</Button>
          <Button onClick={() => act("pendiente_aprobacion", `${orden.numero} corregida y reenviada a aprobación`)}>Reenviar a aprobación</Button>
        </>
      )}
      {orden.estado === "lanzado" && (
        <Button variant="outline" onClick={() => { act("abierto", "Orden reabierta para edición"); if (orden.bcDeepLink) window.open(orden.bcDeepLink, "_blank"); }}>Volver a abrir</Button>
      )}
    </>
  );

  return (
    <>
      <OrdenDetalle orden={orden} volverHref="/proveeduria/ordenes" volverLabel="Volver a órdenes" acciones={acciones} solicitudHref={solicitudHref} />
    </>
  );
}
