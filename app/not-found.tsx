import Link from "next/link";

// 404 con la identidad de la app (antes se veía el 404 crudo de Next.js).
// Reutiliza el layout centrado del login (.login / .login__card).
export default function NotFound() {
  return (
    <div className="login">
      <div className="login__card" style={{ maxWidth: 460, textAlign: "center" }}>
        <div className="row gap-3" style={{ justifyContent: "center", marginBottom: 16 }}>
          <span className="topbar__logo" style={{ width: 44, height: 44, fontSize: 22 }}>A</span>
        </div>
        <div className="ds-heading" style={{ fontSize: 56, lineHeight: 1, marginBottom: 4 }}>404</div>
        <h1 className="ds-subtitle-lg" style={{ marginBottom: 8 }}>Página no encontrada</h1>
        <p className="ds-muted ds-body-sm" style={{ marginBottom: 24 }}>
          La dirección no existe o el recurso se movió de lugar.
        </p>
        <Link href="/" className="ds-btn ds-btn--green" style={{ textDecoration: "none" }}>
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
