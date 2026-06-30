"use client";

import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { useToast } from "@/components/ui";
import { SolicitudForm, type SolicitudInicial } from "@/components/solicitud-form";
import { useStore } from "@/lib/store";

// Copiar una solicitud existente: precarga el form con las mismas líneas/destino y
// crea una solicitud NUEVA (addPedido). Se permite desde cualquier estado.
export default function CopiarSolicitudPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { pedidos, addPedido } = useStore();

  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) {
    return <AppShell role="ingenieria"><main className="page"><div className="empty">Solicitud no encontrada.</div></main></AppShell>;
  }

  const inicial: SolicitudInicial = {
    tipoSolicitud: pedido.tipoSolicitud,
    obraCodigo: pedido.obraCodigo,
    maquinaNo: pedido.maquinaNo,
    solicitante: pedido.solicitante,
    prioridad: pedido.prioridad,
    notas: pedido.notas,
    lineas: pedido.lineas.map((l) => ({ articuloId: l.articuloId, almacen: l.almacen, cantidad: l.cantidad, variantCode: l.variantCode })),
  };

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push(`/ingenieria/${id}`)}>‹ Volver a la solicitud</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Copiar {pedido.numero}</h1>
            <p className="ds-muted">Se crea una solicitud nueva con las mismas líneas. Ajustá lo que necesités antes de guardar.</p>
          </div>
        </div>
        <SolicitudForm
          inicial={inicial}
          textoBoton="Guardar solicitud"
          onCancelar={() => router.push(`/ingenieria/${id}`)}
          guardar={async (input) => {
            const p = await addPedido(input);
            toast(`Solicitud ${p.numero} creada (copia de ${pedido.numero})`, "success");
            router.push(`/ingenieria/${p.id}`);
          }}
        />
      </main>
    </AppShell>
  );
}
