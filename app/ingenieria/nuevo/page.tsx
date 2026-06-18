"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { useToast } from "@/components/ui";
import { SolicitudForm } from "@/components/solicitud-form";
import { useStore } from "@/lib/store";

export default function NuevaSolicitudPage() {
  const router = useRouter();
  const toast = useToast();
  const { addPedido } = useStore();

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/ingenieria")}>‹ Volver a solicitudes</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Nueva solicitud</h1>
            <p className="ds-muted">Indicá el destino y agregá los materiales que necesitás.</p>
          </div>
        </div>
        <SolicitudForm
          textoBoton="Guardar solicitud"
          onCancelar={() => router.push("/ingenieria")}
          guardar={async (input) => {
            const p = await addPedido(input);
            toast(`Solicitud ${p.numero} creada`, "success");
            router.push(`/ingenieria/${p.id}`);
          }}
        />
      </main>
    </AppShell>
  );
}
