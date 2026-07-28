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
      <div className="login__card">
        <div className="row gap-3" style={{ marginBottom: 8 }}>
          <span className="topbar__logo" style={{ width: 44, height: 44, fontSize: 22 }}>A</span>
          <div>
            <h1 className="ds-subtitle-lg">Compras Adelante</h1>
            <p className="ds-muted ds-body-sm">Solicitud de material a proveedores</p>
          </div>
        </div>

        <p className="ds-muted ds-label mt-4" style={{ marginBottom: 12 }}>
          Iniciá sesión con tu usuario
        </p>

        <div className="col gap-3">
          <div className="ds-form-field">
            <label className="ds-form-field__label">Usuario</label>
            <input className="ds-form-field__input" value={username} autoFocus autoCapitalize="off" autoCorrect="off"
              placeholder="username" onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("pw")?.focus(); }} />
          </div>
          <div className="ds-form-field">
            <label className="ds-form-field__label">Contraseña</label>
            <div style={{ position: "relative" }}>
              <input id="pw" className="ds-form-field__input" type={showPw ? "text" : "password"} value={password}
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
          <p className="ds-body-sm" style={{ color: "var(--ds-color-red-100)", marginTop: 12 }}>{error}</p>
        )}

        <Button block className="mt-6" onClick={entrar} disabled={cargando}>
          {cargando ? "Entrando…" : "Entrar"}
        </Button>

        <p className="ds-body-sm ds-muted mt-4" style={{ textAlign: "center" }}>
          Tu rol define a qué módulo entrás · Conectado a Business Central + SQL
        </p>
      </div>
    </div>
  );
}
