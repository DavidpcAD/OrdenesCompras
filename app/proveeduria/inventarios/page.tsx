"use client";

import { AppShell } from "@/components/shell";
import { InventariosView } from "@/components/inventarios-view";

export default function ProveeduriaInventariosPage() {
  return (
    <AppShell role="proveeduria">
      <InventariosView tablaKey="inventarios-prov" />
    </AppShell>
  );
}
