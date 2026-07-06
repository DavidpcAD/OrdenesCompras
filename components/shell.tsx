"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";
import { formatDate } from "@/lib/helpers";
import {
  IconBell, IconList, IconOptions, IconDuplicate, IconMatrix, IconTrack,
  IconReceipt, IconCheck, IconDelivery, IconFolder, IconPlus,
} from "@/components/icons";

type IconCmp = React.ComponentType<{ size?: number }>;
type NavItem = { href: string; label: string; icon: IconCmp };
type RoleAction = { href: string; label: string };

const ROLE_META: Record<Role, { label: string; persona: string; home: string; nav: NavItem[]; action?: RoleAction; color: string }> = {
  ingenieria: {
    label: "Ingeniería", persona: "Laura", home: "/ingenieria", color: "var(--ds-color-green-100)",
    action: { href: "/ingenieria/nuevo", label: "Nueva solicitud" },
    nav: [
      { href: "/ingenieria", label: "Mis solicitudes", icon: IconList },
      { href: "/ingenieria/clasificaciones", label: "Clasificaciones", icon: IconOptions },
      { href: "/ingenieria/plantillas", label: "Plantillas", icon: IconDuplicate },
      { href: "/ingenieria/matriz", label: "Matriz", icon: IconMatrix },
      { href: "/ingenieria/seguimiento", label: "Seguimiento", icon: IconTrack },
    ],
  },
  proveeduria: {
    label: "Proveeduría", persona: "Angie", home: "/proveeduria/ordenes", color: "var(--ds-color-yellow)",
    action: { href: "/proveeduria/directa", label: "Compra directa" },
    nav: [
      { href: "/proveeduria/ordenes", label: "Órdenes creadas", icon: IconReceipt },
      { href: "/proveeduria/solicitudes", label: "Solicitudes", icon: IconList },
      { href: "/proveeduria", label: "Por ordenar", icon: IconOptions },
      { href: "/proveeduria/pedidas", label: "Pedidas", icon: IconCheck },
    ],
  },
  aprobacion: {
    label: "Aprobación", persona: "Luis Roberto", home: "/aprobacion/todas", color: "var(--ds-color-green-200)",
    nav: [
      { href: "/aprobacion/todas", label: "Todas las órdenes", icon: IconReceipt },
      { href: "/aprobacion", label: "Por aprobar", icon: IconCheck },
    ],
  },
  facturacion: {
    label: "Bodega", persona: "Kattya", home: "/facturacion/todas", color: "var(--ds-color-red-100)",
    nav: [
      { href: "/facturacion/todas", label: "Todas las órdenes", icon: IconReceipt },
      { href: "/facturacion", label: "Por recibir", icon: IconDelivery },
      { href: "/facturacion/archivo", label: "Archivo", icon: IconFolder },
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
        {meta.nav.length > 1 && (() => {
          const activeHref = meta.nav.map((x) => x.href).filter((h) => pathname.startsWith(h)).sort((a, b) => b.length - a.length)[0] ?? meta.home;
          return (
            <nav className="topnav topbar__tabs" aria-label="Secciones">
              {meta.nav.map((n) => {
                const Icon = n.icon;
                const active = activeHref === n.href;
                return (
                  <button key={n.href} className={`topnav__item ${active ? "is-active" : ""}`} onClick={() => router.push(n.href)} aria-current={active ? "page" : undefined}>
                    <Icon size={18} />
                    <span>{n.label}</span>
                  </button>
                );
              })}
            </nav>
          );
        })()}
        <div className="topbar__spacer" />
        <div className="topbar__user">
          {/* Acción primaria del rol — siempre visible */}
          {meta.action && (
            <button className="ds-btn ds-btn--green ds-btn--sm topbar__action" onClick={() => router.push(meta.action!.href)}>
              <IconPlus size={18} /><span>{meta.action.label}</span>
            </button>
          )}
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
