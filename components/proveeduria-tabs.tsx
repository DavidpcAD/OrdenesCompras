"use client";

import { usePathname, useRouter } from "next/navigation";

// Pestañas compartidas entre "Materiales solicitados" y "Órdenes creadas"
// para que el segmentado no se pierda al cambiar de pantalla.
export function ProveeduriaTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const enOrdenes = pathname.startsWith("/proveeduria/ordenes");

  return (
    <div className="segmented" role="group" aria-label="Sección de proveeduría">
      <button className={`segmented__btn ${!enOrdenes ? "is-active" : ""}`} aria-current={!enOrdenes ? "page" : undefined}
        onClick={() => { if (enOrdenes) router.push("/proveeduria"); }}>
        Líneas por ordenar
      </button>
      <button className={`segmented__btn ${enOrdenes ? "is-active" : ""}`} aria-current={enOrdenes ? "page" : undefined}
        onClick={() => { if (!enOrdenes) router.push("/proveeduria/ordenes"); }}>
        Órdenes creadas
      </button>
    </div>
  );
}
