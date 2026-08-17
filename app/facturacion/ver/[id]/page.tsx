"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";

export default function BodegaOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ordenes, cargando } = useStore();

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    // Mientras el store carga (modo API) no decir "no encontrada": skeleton.
    if (cargando) {
      return <main className="page"><div className="col gap-4" aria-busy="true">
        <Skeleton style={{ display: "block", width: 240, height: 30, borderRadius: 8 }} />
        <Skeleton style={{ display: "block", width: 360, height: 16, borderRadius: 6 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 340, borderRadius: 16, marginTop: 8 }} />
      </div></main>;
    }
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }

  const acciones = orden.estado === "lanzado" ? (
    <Button variant="green" onClick={() => router.push(`/facturacion/${orden.id}`)}>Registrar factura</Button>
  ) : null;

  return (
    <>
      <OrdenDetalle orden={orden} volverHref="/facturacion/todas" volverLabel="Volver a órdenes" acciones={acciones} />
    </>
  );
}
