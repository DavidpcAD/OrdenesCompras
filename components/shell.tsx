"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";
import { formatDate } from "@/lib/helpers";
import { IconBell } from "@/components/icons";

const ROLE_META: Record<Role, { label: string; persona: string; home: string; nav: { href: string; label: string }[]; color: string }> = {
  ingenieria: {
    label: "Ingeniería", persona: "Laura", home: "/ingenieria", color: "var(--ds-color-green-100)",
    nav: [
      { href: "/ingenieria", label: "Mis solicitudes" },
      { href: "/ingenieria/nuevo", label: "Nueva solicitud" },
      { href: "/ingenieria/clasificaciones", label: "Clasificaciones" },
      { href: "/ingenieria/plantillas", label: "Plantillas" },
      { href: "/ingenieria/matriz", label: "Matriz por obra" },
      { href: "/ingenieria/seguimiento", label: "Seguimiento por proyecto" },
    ],
  },
  proveeduria: {
    label: "Proveeduría", persona: "Angie", home: "/proveeduria/ordenes", color: "var(--ds-color-yellow)",
    nav: [
      { href: "/proveeduria/ordenes", label: "Órdenes creadas" },
      { href: "/proveeduria/solicitudes", label: "Solicitudes" },
      { href: "/proveeduria", label: "Líneas por ordenar" },
      { href: "/proveeduria/pedidas", label: "Líneas pedidas" },
    ],
  },
  aprobacion: {
    label: "Aprobación", persona: "Luis Roberto", home: "/aprobacion/todas", color: "var(--ds-color-green-200)",
    nav: [
      { href: "/aprobacion/todas", label: "Todas las órdenes" },
      { href: "/aprobacion", label: "Por aprobar" },
    ],
  },
  facturacion: {
    label: "Bodega", persona: "Kattya", home: "/facturacion/todas", color: "var(--ds-color-red-100)",
    nav: [
      { href: "/facturacion/todas", label: "Todas las órdenes" },
      { href: "/facturacion", label: "Por recibir" },
      { href: "/facturacion/archivo", label: "Archivo / recepciones" },
    ],
  },
};

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const { role: current, setRole, usuario, setUsuario, notificaciones, marcarNotifsLeidas } = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [notifOpen, setNotifOpen] = useState(false);
  // Notificaciones relevantes para este rol (o sin rol específico).
  const notifsRol = notificaciones.filter((n) => !n.rol || n.rol === role);
  const noLeidas = notifsRol.filter((n) => !n.leida).length;
  function toggleNotif() {
    const open = !notifOpen;
    setNotifOpen(open);
    if (open && noLeidas > 0) setTimeout(() => marcarNotifsLeidas(), 1200);
  }

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
          {/* Campanita de notificaciones */}
          <div style={{ position: "relative" }}>
            <button className="notif-bell" title="Notificaciones" onClick={toggleNotif} aria-label="Notificaciones">
              <IconBell size={20} />{noLeidas > 0 && <span className="notif-bell__dot">{noLeidas > 9 ? "9+" : noLeidas}</span>}
            </button>
            {notifOpen && (
              <>
                <div className="notif-overlay" onClick={() => setNotifOpen(false)} />
                <div className="notif-panel">
                  <div className="notif-panel__head">Notificaciones</div>
                  {notifsRol.length === 0 ? (
                    <div className="notif-empty">Sin notificaciones.</div>
                  ) : (
                    notifsRol.slice(0, 30).map((n) => (
                      <button key={n.id} className={`notif-item ${n.leida ? "" : "is-unread"}`}
                        onClick={() => { setNotifOpen(false); if (n.href) router.push(n.href); }}>
                        <span className="notif-item__msg">{n.mensaje}</span>
                        <span className="notif-item__date">{formatDate(n.fecha)}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <span className="ds-badge" style={{ background: meta.color, color: "var(--ds-color-black)" }}>{meta.label} · {usuario ?? meta.persona}</span>
          <button className="link-btn" onClick={() => { setRole(null); setUsuario(null); router.replace("/"); }}>
            Salir
          </button>
          <span className="topbar__avatar">{(usuario ?? meta.persona).slice(0, 2).toUpperCase()}</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export { ROLE_META };
