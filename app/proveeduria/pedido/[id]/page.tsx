"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// El flujo por-pedido se reemplazó por la tabla agregada de "Materiales solicitados".
export default function RedirectToMateriales() {
  const router = useRouter();
  useEffect(() => { router.replace("/proveeduria"); }, [router]);
  return <div className="page"><div className="empty">Redirigiendo…</div></div>;
}
