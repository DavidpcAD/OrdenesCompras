"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdelanteMark } from "@/components/icons";

// ¿El error es porque salió una versión nueva de la app con esta pestaña abierta?
//
// Pasa así: la pestaña lleva horas o días abierta (ahora la sesión dura 30 días, así
// que es lo normal), se despliega una versión nueva, y al cambiar de pantalla el
// navegador pide un pedazo de JavaScript de la versión VIEJA que ya no existe en el
// servidor. No hay nada roto: basta con recargar.
function esVersionNueva(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  return /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
    .test(error.message ?? "");
}

const CLAVE_RECARGA = "adelante_oc_recarga_version";

// Error boundary con la identidad de la app: ante un error de runtime en un
// segmento, muestra una pantalla amable con reintentar / volver, en vez de la
// pantalla de error cruda de Next.js.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [recargando, setRecargando] = useState(false);

  // Versión nueva: se recarga SOLA, una vez. Si en el último minuto ya se recargó por
  // esto y volvió a pasar, no es la versión: se muestra el error de siempre en vez de
  // entrar en un bucle de recargas.
  useEffect(() => {
    if (!esVersionNueva(error)) return;
    try {
      const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0);
      if (Date.now() - ultima < 60_000) return;
      sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
    } catch {
      return;   // sin sessionStorage no hay cómo evitar el bucle: mejor no recargar
    }
    setRecargando(true);
    window.location.reload();
  }, [error]);

  return (
    <div className="login">
      <div className="login__card" style={{ maxWidth: 480, textAlign: "center" }}>
        <div className="row gap-3" style={{ justifyContent: "center", marginBottom: 16 }}>
          <span className="topbar__logo" style={{ width: 44, height: 44 }}><AdelanteMark width={26} /></span>
        </div>
        {recargando ? (
          <>
            <h1 className="ds-subtitle-lg" style={{ marginBottom: 8 }}>Hay una versión nueva de la app</h1>
            <p className="ds-muted ds-body-sm">Recargando para traerla…</p>
          </>
        ) : (
          <>
            <h1 className="ds-subtitle-lg" style={{ marginBottom: 8 }}>Algo salió mal</h1>
            <p className="ds-muted ds-body-sm" style={{ marginBottom: 24 }}>
              Ocurrió un error inesperado. Podés reintentar o volver al inicio.
            </p>
            <div className="row gap-3" style={{ justifyContent: "center" }}>
              <button type="button" className="ds-btn ds-btn--green" onClick={() => reset()}>
                Reintentar
              </button>
              <Link href="/" className="ds-btn ds-btn--white" style={{ textDecoration: "none" }}>
                Volver al inicio
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
