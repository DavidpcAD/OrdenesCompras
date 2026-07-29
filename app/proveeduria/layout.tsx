"use client";

import { AppShell } from "@/components/shell";

// El shell (riel/drawer + topbar) vive acá para PERSISTIR entre navegaciones:
// al cambiar de página solo se reemplaza el contenido, no se remonta el menú
// (antes cada página montaba su propio AppShell y "saltaba" al navegar).
export default function ProveeduriaLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="proveeduria">{children}</AppShell>;
}
