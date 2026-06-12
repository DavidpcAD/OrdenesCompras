"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui";
import type { Role } from "@/lib/types";

const ROLES: { id: Role; title: string; desc: string; icon: string; bg: string }[] = [
  { id: "ingenieria", title: "Ingeniería", desc: "Crear y dar seguimiento a pedidos de material", icon: "🛠️", bg: "color-mix(in srgb, var(--ds-color-green-100) 22%, #fff)" },
  { id: "proveeduria", title: "Proveeduría", desc: "Convertir pedidos en órdenes de compra al proveedor", icon: "📦", bg: "color-mix(in srgb, var(--ds-color-yellow) 28%, #fff)" },
  { id: "facturacion", title: "Facturación", desc: "Registrar recepción de material y facturas", icon: "🧾", bg: "color-mix(in srgb, var(--ds-color-red-100) 22%, #fff)" },
];

export default function LoginPage() {
  const { setRole } = useStore();
  const router = useRouter();
  const [selected, setSelected] = useState<Role | null>(null);

  function entrar() {
    if (!selected) return;
    setRole(selected);
    router.push(`/${selected}`);
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
          Seleccioná tu módulo para continuar
        </p>

        <div className="role-grid">
          {ROLES.map((r) => (
            <button
              key={r.id}
              className={`role-option ${selected === r.id ? "is-selected" : ""}`}
              onClick={() => setSelected(r.id)}
              type="button"
            >
              <span className="role-option__icon" style={{ background: r.bg }}>{r.icon}</span>
              <span className="col" style={{ gap: 2 }}>
                <span className="role-option__title">{r.title}</span>
                <span className="role-option__desc">{r.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <Button block className="mt-6" onClick={entrar} disabled={!selected}>
          Entrar como {selected ? ROLES.find((r) => r.id === selected)!.title : "…"}
        </Button>

        <p className="ds-body-sm ds-muted mt-4" style={{ textAlign: "center" }}>
          Conectado a Business Central · espejo en SQL
        </p>
      </div>
    </div>
  );
}
