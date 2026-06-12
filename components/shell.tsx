"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";

const ROLE_META: Record<Role, { label: string; home: string; nav: { href: string; label: string }[]; color: string }> = {
  ingenieria: {
    label: "Ingeniería", home: "/ingenieria", color: "var(--ds-color-green-100)",
    nav: [
      { href: "/ingenieria", label: "Mis pedidos" },
      { href: "/ingenieria/nuevo", label: "Nuevo pedido" },
    ],
  },
  proveeduria: {
    label: "Proveeduría", home: "/proveeduria", color: "var(--ds-color-yellow)",
    nav: [
      { href: "/proveeduria", label: "Pedidos por ordenar" },
      { href: "/proveeduria/ordenes", label: "Órdenes" },
    ],
  },
  facturacion: {
    label: "Facturación", home: "/facturacion", color: "var(--ds-color-red-100)",
    nav: [
      { href: "/facturacion", label: "Órdenes por recibir" },
      { href: "/facturacion/archivo", label: "Archivo / recepciones" },
    ],
  },
};

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const { role: current, setRole } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  // guard: si no hay rol o no coincide, mandar al login
  useEffect(() => {
    if (current === null) router.replace("/");
    else if (current !== role) router.replace(ROLE_META[current].home);
  }, [current, role, router]);

  if (current !== role) {
    return <div className="page"><div className="empty">Cargando…</div></div>;
  }

  const meta = ROLE_META[role];

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href={meta.home} className="topbar__brand">
          <span className="topbar__logo">A</span>
          <span>Compras Adelante</span>
        </Link>
        <nav className="topbar__nav">
          {meta.nav.map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href} className={`topbar__link ${active ? "is-active" : ""}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="topbar__spacer" />
        <div className="topbar__user">
          <span className="ds-badge" style={{ background: meta.color, color: "#000" }}>{meta.label}</span>
          <button className="link-btn" onClick={() => { setRole(null); router.replace("/"); }}>
            Cambiar rol
          </button>
          <span className="topbar__avatar">DC</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export { ROLE_META };
