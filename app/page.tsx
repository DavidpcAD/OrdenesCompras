"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui";
import { AdelanteMark } from "@/components/icons";
import { ROLE_META } from "@/components/shell";

export default function LoginPage() {
  const { setRole, setUsuario } = useStore();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [ayudaPw, setAyudaPw] = useState(false);
  // A dónde volver después de entrar, y por qué está acá. Los pone quien lo mandó
  // al login: el middleware (página protegida sin sesión) o el guard de fetch
  // (401 en medio del trabajo). Se leen de window y no con useSearchParams para no
  // arrastrar un Suspense en la pantalla de entrada.
  const [volverA, setVolverA] = useState<string | null>(null);
  const [vencida, setVencida] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setVencida(sp.get("motivo") === "sesion");
    const next = sp.get("next");
    // Solo rutas internas: un "next" que venga con http(s):// o con "//" sería un
    // redirect abierto (te logueás acá y terminás en otro sitio).
    if (next && next.startsWith("/") && !next.startsWith("//")) setVolverA(next);
  }, []);

  async function entrar() {
    if (!username.trim() || !password) { setError("Ingresá usuario y contraseña."); return; }
    setError(""); setCargando(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data?.error || "No se pudo iniciar sesión."); setCargando(false); return; }
      setRole(data.role);
      setUsuario(data.nombre || username.trim());
      const home = ROLE_META[data.role as keyof typeof ROLE_META]?.home ?? `/${data.role}`;
      // Vuelve a la pantalla donde lo cortó la sesión, si es del área de su rol.
      const area = `/${home.split("/")[1]}`;
      const vuelveAlArea = !!volverA && (volverA === area || volverA.startsWith(area + "/"));
      router.push(vuelveAlArea ? volverA! : home);
    } catch (e: any) {
      const raw = String(e?.message ?? e);
      // "Failed to fetch" no le dice nada a nadie.
      setError(/failed to fetch|networkerror|load failed/i.test(raw) ? "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo." : raw);
      setCargando(false);
    }
  }

  return (
    <div className="login">
      {/* Panel de marca (siempre oscuro), estilo "Sistema interno" */}
      <aside className="login__aside">
        <div className="login__brand">
          <span className="topbar__logo" style={{ width: 44, height: 44 }}><AdelanteMark width={26} /></span>
          <div>
            <div className="login__brand-name">Adelante</div>
            <div className="login__brand-sub">Desarrollos</div>
          </div>
        </div>

        <div className="login__aside-mid">
          <span className="login__eyebrow">Sistema interno</span>
          <h1 className="login__headline">Proveeduría</h1>
          <p className="login__lead">
            Solicitudes y órdenes de compra, recepción de material y facturación. Integrado con Business Central.
          </p>
          <div className="login__features">
            <div className="login__feature">
              <span className="login__feature-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              </span>
              <span>Solicitudes y órdenes de compra</span>
            </div>
            <div className="login__feature">
              <span className="login__feature-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>
              </span>
              <span>Recepción de material y facturación</span>
            </div>
            <div className="login__feature">
              <span className="login__feature-ic">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>
              </span>
              <span>Integrado con Business Central + SQL</span>
            </div>
          </div>
        </div>

        <div className="login__aside-foot">© 2026 Adelante Desarrollos · Sistema interno</div>
      </aside>

      {/* Panel del formulario */}
      <main className="login__main">
      <div className="login__card">
        {/* Marca compacta: solo visible en móvil (en desktop está en el panel izquierdo) */}
        <div className="login__card-brand">
          <span className="topbar__logo" style={{ width: 40, height: 40 }}><AdelanteMark width={24} /></span>
          <div>
            <h1 className="ds-subtitle">Compras Adelante</h1>
            <p className="ds-muted ds-body-sm">Solicitud de material a proveedores</p>
          </div>
        </div>

        <div className="login__form-head">
          <h2 className="ds-subtitle">Iniciar sesión</h2>
          <p className="ds-muted ds-body-sm">Ingresá tu usuario y contraseña para continuar</p>
        </div>

        {/* Por qué lo devolvimos acá. Sin este aviso, el que estaba trabajando y de
            repente aterriza en el login cree que la app se rompió. */}
        {vencida && !error && (
          <div className="ds-callout ds-callout--yellow" role="status" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="ds-callout__title">Tu sesión venció</div>
              <div className="ds-callout__body">
                Por seguridad se cierra sola después de 12 horas sin usarla. Entrá de nuevo
                {volverA ? " y te devolvemos a la pantalla donde estabas." : "."}
              </div>
            </div>
          </div>
        )}

        {/* Form de verdad (no divs): así los gestores de contraseñas ofrecen guardar
            y Enter envía sin depender de handlers por campo. */}
        <form onSubmit={(e) => { e.preventDefault(); if (!cargando) entrar(); }}>
        <div className="col gap-3">
          <div className="ds-form-field">
            <label className="ds-form-field__label" htmlFor="username">Usuario</label>
            <input id="username" name="username" autoComplete="username" className="ds-form-field__input" value={username} autoFocus autoCapitalize="off" autoCorrect="off"
              placeholder="username" onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("pw")?.focus(); } }} />
          </div>
          <div className="ds-form-field">
            <label className="ds-form-field__label" htmlFor="pw">Contraseña</label>
            <div style={{ position: "relative" }}>
              <input id="pw" name="password" autoComplete="current-password" className="ds-form-field__input" type={showPw ? "text" : "password"} value={password}
                placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 46 }} />
              <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Ocultar contraseña" : "Ver contraseña"} title={showPw ? "Ocultar contraseña" : "Ver contraseña"}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, cursor: "pointer", color: showPw ? "var(--ds-color-green-200)" : "var(--ds-color-gray-500)", display: "inline-flex", padding: 4 }}>
                {showPw ? (
                  // ojo tachado (ocultar)
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.4 5A10.9 10.9 0 0 1 12 4.7c6.5 0 10 7.3 10 7.3a17.7 17.7 0 0 1-3 3.9" /><path d="M6.3 6.6A17.6 17.6 0 0 0 2 12s3.5 7.3 10 7.3a10.8 10.8 0 0 0 3.3-.5" /></svg>
                ) : (
                  // ojo (ver)
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7.3 10-7.3S22 12 22 12s-3.5 7.3-10 7.3S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
            <button type="button" className="link-btn ds-body-sm" style={{ marginTop: 6, alignSelf: "flex-start" }} onClick={() => setAyudaPw((v) => !v)}>
              ¿Olvidaste tu contraseña?
            </button>
            {ayudaPw && (
              <p className="ds-body-sm ds-muted" style={{ marginTop: 4 }}>
                Escribí a <strong>TI (davidpc@adelante.cr)</strong> para restablecerla.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="ds-body-sm" style={{ color: "var(--ds-color-red-100)", marginTop: 12 }}>{error}</p>
        )}

        <Button type="submit" block className="mt-6" disabled={cargando}>
          {cargando ? "Entrando…" : "Entrar"}
        </Button>
        </form>

        <p className="ds-body-sm ds-muted mt-4" style={{ textAlign: "center" }}>
          Tu rol define a qué módulo entrás · Conectado a Business Central + SQL
        </p>
      </div>
      </main>
    </div>
  );
}
