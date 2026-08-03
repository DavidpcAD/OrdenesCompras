"use client";

import Link from "next/link";

// Error boundary con la identidad de la app: ante un error de runtime en un
// segmento, muestra una pantalla amable con reintentar / volver, en vez de la
// pantalla de error cruda de Next.js.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="login">
      <div className="login__card" style={{ maxWidth: 480, textAlign: "center" }}>
        <div className="row gap-3" style={{ justifyContent: "center", marginBottom: 16 }}>
          <span className="topbar__logo" style={{ width: 44, height: 44, fontSize: 22 }}>A</span>
        </div>
        <h1 className="ds-subtitle-lg" style={{ marginBottom: 8 }}>Algo salió mal</h1>
        <p className="ds-muted ds-body-sm" style={{ marginBottom: 24 }}>
          Ocurrió un error inesperado. Podés reintentar o volver al inicio.
        </p>
        <div className="row gap-3" style={{ justifyContent: "center" }}>
          <button type="button" className="ds-btn ds-btn--green" onClick={() => reset()}>
            Reintentar
          </button>
          <Link href="/" className="ds-btn ds-btn--ghost" style={{ textDecoration: "none" }}>
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
