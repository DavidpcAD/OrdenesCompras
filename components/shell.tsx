"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";

const ROLE_META: Record<Role, { label: string; persona: string; home: string; nav: { href: string; label: string }[]; color: string }> = {
  ingenieria: {
    label: "Ingeniería", persona: "Laura", home: "/ingenieria", color: "var(--ds-color-green-100)",
    nav: [
      { href: "/ingenieria", label: "Mis solicitudes" },
      { href: "/ingenieria/nuevo", label: "Nueva solicitud" },
      { href: "/ingenieria/seguimiento", label: "Seguimiento por proyecto" },
    ],
  },
  proveeduria: {
    label: "Proveeduría", persona: "Angie", home: "/proveeduria", color: "var(--ds-color-yellow)",
    nav: [
      { href: "/proveeduria", label: "Líneas por ordenar" },
      { href: "/proveeduria/ordenes", label: "Órdenes creadas" },
    ],
  },
  aprobacion: {
    label: "Aprobación", persona: "Luis Roberto", home: "/aprobacion", color: "var(--ds-color-green-200)",
    nav: [
      { href: "/aprobacion", label: "Por aprobar" },
      { href: "/aprobacion/todas", label: "Todas las órdenes" },
    ],
  },
  facturacion: {
    label: "Bodega", persona: "Kattya", home: "/facturacion", color: "var(--ds-color-red-100)",
    nav: [
      { href: "/facturacion", label: "Por recibir" },
      { href: "/facturacion/todas", label: "Todas las órdenes" },
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
        {meta.nav.length > 1 && (
          <div className="segmented topbar__tabs">
            {meta.nav.map((n) => {
              const matches = meta.nav.map((x) => x.href).filter((h) => pathname.startsWith(h)).sort((a, b) => b.length - a.length);
              const activeHref = matches[0] ?? meta.home;
              return (
                <button key={n.href} className={`segmented__btn ${activeHref === n.href ? "is-active" : ""}`} onClick={() => router.push(n.href)}>
                  {n.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="topbar__spacer" />
        <div className="topbar__user">
          <span className="ds-badge" style={{ background: meta.color, color: "#000" }}>{meta.label} · {meta.persona}</span>
          <button className="link-btn" onClick={() => { setRole(null); router.replace("/"); }}>
            Cambiar rol
          </button>
          <span className="topbar__avatar">{meta.persona.slice(0, 2).toUpperCase()}</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export { ROLE_META };
