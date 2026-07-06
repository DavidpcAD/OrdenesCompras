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
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

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
            <input id="pw" className="ds-form-field__input" type="password" value={password}
              placeholder="••••••••" onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") entrar(); }} />
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
