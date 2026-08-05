"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui";
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
      router.push(ROLE_META[data.role as keyof typeof ROLE_META]?.home ?? `/${data.role}`);
    } catch (e: any) {
      setError(String(e?.message ?? e)); setCargando(false);
    }
  }

  return (
    <div className="login">
      {/* Panel de marca (siempre oscuro), estilo "Sistema interno" */}
      <aside className="login__aside">
        <div className="login__brand">
          <span className="topbar__logo" style={{ width: 44, height: 44, fontSize: 22 }}>A</span>
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
          <span className="topbar__logo" style={{ width: 40, height: 40, fontSize: 20 }}>A</span>
          <div>
            <h1 className="ds-subtitle">Compras Adelante</h1>
            <p className="ds-muted ds-body-sm">Solicitud de material a proveedores</p>
          </div>
        </div>

        <div className="login__form-head">
          <h2 className="ds-subtitle">Iniciar sesión</h2>
          <p className="ds-muted ds-body-sm">Ingresá tu usuario y contraseña para continuar</p>
        </div>

        <div className="col gap-3">
          <div className="ds-form-field">
            <label className="ds-form-field__label" htmlFor="username">Usuario</label>
            <input id="username" name="username" autoComplete="username" className="ds-form-field__input" value={username} autoFocus autoCapitalize="off" autoCorrect="off"
              placeholder="username" onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("pw")?.focus(); }} />
          </div>
          <div className="ds-form-field">
            <label className="ds-form-field__label" htmlFor="pw">Contraseña</label>
            <div style={{ position: "relative" }}>
              <input id="pw" name="password" autoComplete="current-password" className="ds-form-field__input" type={showPw ? "text" : "password"} value={password}
                placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 46 }}
                onKeyDown={(e) => { if (e.key === "Enter") entrar(); }} />
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

        <Button block className="mt-6" onClick={entrar} disabled={cargando}>
          {cargando ? "Entrando…" : "Entrar"}
        </Button>

        <p className="ds-body-sm ds-muted mt-4" style={{ textAlign: "center" }}>
          Tu rol define a qué módulo entrás · Conectado a Business Central + SQL
        </p>
      </div>
      </main>
    </div>
  );
}
