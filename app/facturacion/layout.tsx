"use client";

import { AppShell } from "@/components/shell";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";

// /facturacion lo comparten Bodega (facturacion) y Contabilidad; el rol lo define
// el usuario logueado (no la URL). El shell persiste entre páginas del segmento.
export default function FacturacionLayout({ children }: { children: React.ReactNode }) {
  const { role } = useStore();
  const r: Role = role === "contabilidad" ? "contabilidad" : "facturacion";
  return <AppShell role={r}>{children}</AppShell>;
}
