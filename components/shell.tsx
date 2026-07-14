"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { Role, Notificacion } from "@/lib/types";
import { formatDate } from "@/lib/helpers";
import {
  IconBell, IconList, IconOptions, IconDuplicate, IconMatrix, IconTrack,
  IconReceipt, IconCheck, IconDelivery, IconFolder, IconPlus, IconLogout,
  IconBox, IconWarning,
} from "@/components/icons";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Ícono por tipo de notificación (el color lo da la clase notif-item__icon--<tipo>).
const NOTIF_ICON: Record<Notificacion["tipo"], React.ReactNode> = {
  pedido: <IconList size={18} />,
  orden: <IconBox size={18} />,
  factura: <IconReceipt size={18} />,
  devuelto: <IconWarning size={18} />,
};

type IconCmp = React.ComponentType<{ size?: number }>;
// alt: rutas extra que activan esta pestaña. Prefijo por defecto; sufijo "$" = ruta exacta.
type NavItem = { href: string; label: string; icon: IconCmp; alt?: string[] };
type RoleAction = { href: string; label: string };

const ROLE_META: Record<Role, { label: string; persona: string; home: string; nav: NavItem[]; action?: RoleAction; color: string }> = {
  ingenieria: {
    label: "Ingeniería", persona: "Laura", home: "/ingenieria", color: "var(--ds-color-green-100)",
    nav: [
      { href: "/ingenieria", label: "Mis solicitudes", icon: IconList },
      { href: "/ingenieria/clasificaciones", label: "Clasificaciones", icon: IconOptions },
      { href: "/ingenieria/plantillas", label: "Plantillas", icon: IconDuplicate },
      { href: "/ingenieria/matriz", label: "Matriz", icon: IconMatrix },
      { href: "/ingenieria/seguimiento", label: "Seguimiento", icon: IconTrack },
    ],
  },
  proveeduria: {
    label: "Proveeduría", persona: "Angie", home: "/proveeduria/solicitudes", color: "var(--ds-color-yellow)",
    action: { href: "/proveeduria/directa", label: "Compra directa" },
    nav: [
      // Órdenes y Solicitudes son un mismo concepto cada uno, con dos vistas
      // (por documento / por línea) que se alternan con un toggle dentro de la página.
      { href: "/proveeduria/solicitudes", label: "Solicitudes", icon: IconList, alt: ["/proveeduria$"] },
      { href: "/proveeduria/ordenes", label: "Órdenes", icon: IconReceipt, alt: ["/proveeduria/pedidas"] },
    ],
  },
  aprobacion: {
    label: "Aprobación", persona: "Luis Roberto", home: "/aprobacion", color: "var(--ds-color-green-200)",
    nav: [
      { href: "/aprobacion", label: "Por aprobar", icon: IconCheck },
      { href: "/aprobacion/todas", label: "Todas las órdenes", icon: IconReceipt },
    ],
  },
  facturacion: {
    label: "Bodega", persona: "Kattya", home: "/facturacion", color: "var(--ds-color-red-100)",
    nav: [
      { href: "/facturacion", label: "Por recibir", icon: IconDelivery },
      { href: "/facturacion/todas", label: "Todas las órdenes", icon: IconReceipt },
      { href: "/facturacion/archivo", label: "Archivo", icon: IconFolder },
    ],
  },
};

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const { role: current, setRole, usuario, setUsuario, notificaciones, marcarNotifsLeidas, hydrated } = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [notifOpen, setNotifOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  // Notificaciones relevantes para este rol (o sin rol específico).
  const notifsRol = notificaciones.filter((n) => !n.rol || n.rol === role);
  const noLeidas = notifsRol.filter((n) => !n.leida).length;
  function toggleNotif() {
    const open = !notifOpen;
    setNotifOpen(open);
    if (open && noLeidas > 0) setTimeout(() => marcarNotifsLeidas(), 1200);
  }

  // guard: esperar a que el store lea el rol de localStorage (hydrated) para no
  // rebotar al login al recargar la página. Solo entonces se decide redirigir.
  useEffect(() => {
    if (!hydrated) return;
    if (current === null) router.replace("/");
    else if (current !== role) router.replace(ROLE_META[current].home);
  }, [current, role, router, hydrated]);

  if (!hydrated || current !== role) {
    return <div className="page"><div className="empty">Cargando…</div></div>;
  }

  const meta = ROLE_META[role];
  const hasNav = meta.nav.length > 1;
  // Cuál item del nav está activo (match más largo por href/alt).
  const activeHref = meta.nav
    .map((n) => {
      let len = pathname.startsWith(n.href) ? n.href.length : 0;
      for (const a of n.alt ?? []) {
        if (a.endsWith("$")) { if (pathname === a.slice(0, -1)) len = Math.max(len, 1000); }
        else if (pathname.startsWith(a)) len = Math.max(len, a.length);
      }
      return { href: n.href, len };
    })
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len)[0]?.href ?? meta.home;

  return (
    <div className="app-shell">
      <header className="topbar">
        {hasNav && (
          <button className="topbar__menu" onClick={() => setNavCollapsed((v) => !v)} aria-label={navCollapsed ? "Expandir menú" : "Colapsar menú"} title="Menú">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        )}
        <Link href={meta.home} className="topbar__brand">
          <span className="topbar__logo">A</span>
          <span>Compras Adelante</span>
        </Link>
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
                  <div className="notif-panel__head">
                    <span className="notif-panel__title">Notificaciones</span>
                    {noLeidas > 0 && <span className="notif-panel__count">{noLeidas} sin leer</span>}
                  </div>
                  {notifsRol.length === 0 ? (
                    <div className="notif-empty">
                      <span className="notif-empty__icon"><IconBell size={22} /></span>
                      Sin notificaciones
                    </div>
                  ) : (
                    <div className="notif-list">
                      {notifsRol.slice(0, 30).map((n) => (
                        <button key={n.id} className={`notif-item ${n.leida ? "" : "is-unread"}`}
                          onClick={() => { setNotifOpen(false); if (n.href) router.push(n.href); }}>
                          <span className={`notif-item__icon notif-item__icon--${n.tipo}`}>{NOTIF_ICON[n.tipo]}</span>
                          <span className="notif-item__body">
                            <span className="notif-item__msg">{n.mensaje}</span>
                            <span className="notif-item__date">{formatDate(n.fecha)}</span>
                          </span>
                          {!n.leida && <span className="notif-item__dot" aria-hidden />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="topbar__identity" style={{ background: meta.color }}>
            <span className="topbar__avatar">{(usuario ?? meta.persona).slice(0, 2).toUpperCase()}</span>
            <span>{cap(usuario ?? meta.persona)} · {meta.label}</span>
          </div>
          <button className="icon-btn topbar__salir" title="Salir" aria-label="Salir" onClick={() => { setRole(null); setUsuario(null); router.replace("/"); }}>
            <IconLogout size={18} /><span>Salir</span>
          </button>
        </div>
      </header>
      <div className="app-body">
        {hasNav && (
          <aside className={`app-nav${navCollapsed ? " is-collapsed" : ""}`} aria-label="Secciones">
            {meta.nav.map((n) => {
              const Icon = n.icon;
              const active = activeHref === n.href;
              return (
                <button key={n.href} className={`app-nav__item${active ? " is-active" : ""}`}
                  title={navCollapsed ? n.label : undefined}
                  onClick={() => router.push(n.href)} aria-current={active ? "page" : undefined}>
                  <Icon size={20} />
                  <span className="app-nav__label">{n.label}</span>
                </button>
              );
            })}
          </aside>
        )}
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

export { ROLE_META };
