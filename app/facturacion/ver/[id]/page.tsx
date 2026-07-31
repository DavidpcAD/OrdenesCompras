"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, EmptyState } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";

export default function BodegaOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ordenes } = useStore();

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }

  const acciones = orden.estado === "lanzado" ? (
    <Button variant="red" onClick={() => router.push(`/facturacion/${orden.id}`)}>Registrar factura</Button>
  ) : null;

  return (
    <>
      <OrdenDetalle orden={orden} volverHref="/facturacion/todas" volverLabel="Volver a órdenes" acciones={acciones} />
    </>
  );
}
