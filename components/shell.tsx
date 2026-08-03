"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { ConfirmDialog } from "@/components/ui";
import type { Role, Notificacion } from "@/lib/types";
import { formatDate } from "@/lib/helpers";
import {
  IconBell, IconList, IconReceipt, IconCheck, IconDelivery, IconFolder,
  IconPlus, IconLogout, IconBox, IconWarning, IconDashboard, IconEdit,
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
  proveeduria: {
    label: "Proveeduría", persona: "Angie", home: "/proveeduria/dashboard", color: "var(--ds-color-yellow)",
    action: { href: "/proveeduria/directa", label: "Compra directa" },
    nav: [
      // Órdenes y Solicitudes son un mismo concepto cada uno, con dos vistas
      // (por documento / por línea) que se alternan con un toggle dentro de la página.
      { href: "/proveeduria/dashboard", label: "Dashboard", icon: IconDashboard },
      { href: "/proveeduria/solicitudes", label: "Solicitudes", icon: IconList, alt: ["/proveeduria$"] },
      { href: "/proveeduria/ordenes", label: "Órdenes", icon: IconReceipt, alt: ["/proveeduria/pedidas", "/proveeduria/nueva", "/proveeduria/directa"] },
      { href: "/proveeduria/devoluciones", label: "Devoluciones", icon: IconWarning },
      { href: "/proveeduria/inventarios", label: "Inventarios", icon: IconBox },
    ],
  },
  facturacion: {
    // Bodega (ej. Pedro): recibe el material. Interfaz mínima — solo lo por recibir.
    label: "Bodega", persona: "Pedro", home: "/facturacion", color: "var(--ds-color-red-100)",
    nav: [
      { href: "/facturacion", label: "Órdenes por recibir", icon: IconDelivery },
      { href: "/facturacion/recibidas", label: "Recibidas", icon: IconCheck },
    ],
  },
  contabilidad: {
    // Contabilidad (ej. Kathya): notas de crédito, cargos de tercero, consulta y archivo.
    label: "Contabilidad", persona: "Kattya", home: "/facturacion/notas-credito", color: "var(--ds-color-gray-300)",
    nav: [
      { href: "/facturacion/notas-credito", label: "Notas de crédito", icon: IconEdit },
      { href: "/facturacion/cargo", label: "Cargo sobre factura", icon: IconPlus },
      { href: "/facturacion/todas", label: "Todas las órdenes", icon: IconReceipt },
      { href: "/facturacion/archivo", label: "Archivo", icon: IconFolder },
    ],
  },
};

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const { role: current, setRole, usuario, setUsuario, notificaciones, marcarNotifsLeidas, marcarNotifLeida, hydrated } = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [notifOpen, setNotifOpen] = useState(false);
  // Desktop: RIEL de íconos. Colapsado por defecto; se expande al pasar el mouse
  // (preview) y el toggle lo FIJA (pinned) empujando el contenido. Se recuerda.
  const [pinned, setPinned] = useState(false);
  // Móvil: DRAWER que abre el FAB de menú (overlay temporal).
  const [navOpen, setNavOpen] = useState(false);
  const [ready, setReady] = useState(false); // evita animar el riel al cargar
  const [logoutOpen, setLogoutOpen] = useState(false);
  const isMobile = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
  const closeNavOnMobile = () => { if (isMobile()) setNavOpen(false); };
  useEffect(() => {
    setPinned(localStorage.getItem("adelante_oc_navpin") === "1");
    setReady(true);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem("adelante_oc_navpin", pinned ? "1" : "0"); } catch {} }, [pinned, ready]);
  // Cerrar el drawer móvil al navegar.
  useEffect(() => { if (isMobile()) setNavOpen(false); }, [pathname]);
  // Cerrar con Escape el drawer móvil y el panel de notificaciones.
  useEffect(() => {
    if (!navOpen && !notifOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setNavOpen(false); setNotifOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, notifOpen]);
  function cerrarSesion() {
    setLogoutOpen(false);
    // Borra la cookie de sesión del server además del estado local.
    fetch("/api/logout", { method: "POST" }).catch(() => {}).finally(() => {
      setRole(null); setUsuario(null); router.replace("/");
    });
  }
  // Notificaciones relevantes para este rol (o sin rol específico).
  const notifsRol = notificaciones.filter((n) => !n.rol || n.rol === role);
  const noLeidas = notifsRol.filter((n) => !n.leida).length;
  function toggleNotif() {
    // Abrir el panel NO marca leídas: cada notificación queda resaltada (no leída)
    // hasta que el usuario la abre (clic) o usa "Marcar todas como leídas".
    setNotifOpen((o) => !o);
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
  // FAB de acción visible → el contenido necesita espacio inferior para no quedar tapado.
  const showActionFab = !!meta.action && pathname !== meta.action.href && !pathname.includes("/nueva");
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
    .sort((a, b) => b.len - a.len)[0]?.href ?? "";  // sin match → no se marca ninguna (no cae al home)

  return (
    <div className={`app-shell${pinned ? " pinned" : ""}${navOpen ? " nav-open" : ""}${ready ? " is-ready" : ""}`}>
      {/* Skip link (a11y, WCAG 2.4.1): primer foco de teclado; salta el nav. */}
      <a href="#contenido-principal" className="skip-link">Saltar al contenido</a>
      <header className="topbar">
        <div className="topbar__spacer" />
        <div className="topbar__user">
          {/* Campanita de notificaciones */}
          <div style={{ position: "relative" }}>
            <button className="notif-bell" title="Notificaciones" onClick={toggleNotif} aria-label="Notificaciones" aria-haspopup="menu" aria-expanded={notifOpen}>
              <IconBell size={20} />{noLeidas > 0 && <span className="notif-bell__dot">{noLeidas > 9 ? "9+" : noLeidas}</span>}
            </button>
            {notifOpen && (
              <>
                <div className="notif-overlay" onClick={() => setNotifOpen(false)} />
                <div className="notif-panel">
                  <div className="notif-panel__head">
                    <span className="notif-panel__title">Notificaciones</span>
                    {noLeidas > 0 && (
                      <button type="button" className="notif-panel__mark" onClick={() => marcarNotifsLeidas()}>
                        {noLeidas} sin leer · Marcar todas
                      </button>
                    )}
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
                          onClick={() => { marcarNotifLeida(n.id); setNotifOpen(false); if (n.href) router.push(n.href); }}>
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
          <div className="topbar__identity" style={{ background: "var(--ds-color-black)", color: "var(--ds-color-white)" }}>
            <span className="topbar__avatar">{(usuario ?? meta.persona).slice(0, 2).toUpperCase()}</span>
            <span>{cap(usuario ?? meta.persona)} · {meta.label}</span>
          </div>
        </div>
      </header>
      {hasNav && (
        <>
          {/* Fondo oscuro detrás del drawer (solo visible en móvil). */}
          {navOpen && <div className="app-nav-overlay" onClick={() => setNavOpen(false)} aria-hidden />}
          {/* En móvil abierto actúa como drawer modal → role=dialog/aria-modal
              (solo con navOpen; en desktop el mismo <aside> es el rail, no modal). */}
          <nav className={`app-nav${navOpen ? " is-open" : ""}`} aria-label="Secciones"
            role={navOpen ? "dialog" : undefined} aria-modal={navOpen ? true : undefined}>
            <div className="app-nav__head">
              {/* Desktop: hamburguesa que abre/fija (empuja) y encoge el riel. Siempre visible. */}
              <button type="button" className="app-nav__burger" onClick={() => setPinned((p) => !p)}
                aria-label={pinned ? "Encoger menú" : "Expandir menú"} title={pinned ? "Encoger menú" : "Expandir menú"} aria-pressed={pinned}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
              </button>
              <Link href={meta.home} className="app-nav__brand" title="Compras Adelante" onClick={closeNavOnMobile}>
                <span className="topbar__logo">A</span>
                <span className="app-nav__brand-name">Compras Adelante</span>
              </Link>
              {/* Móvil: cerrar el drawer. */}
              <button type="button" className="app-nav__close" onClick={() => setNavOpen(false)} aria-label="Cerrar menú">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {meta.nav.map((n) => {
              const Icon = n.icon;
              const active = activeHref === n.href;
              return (
                <button key={n.href} className={`app-nav__item${active ? " is-active" : ""}`}
                  title={n.label}
                  onClick={() => { router.push(n.href); closeNavOnMobile(); }} aria-current={active ? "page" : undefined}>
                  <span className="app-nav__ic"><Icon size={20} /></span>
                  <span className="app-nav__label">{n.label}</span>
                </button>
              );
            })}
            <button className="app-nav__item app-nav__salir" title="Salir"
              onClick={() => { setNavOpen(false); setLogoutOpen(true); }}>
              <span className="app-nav__ic"><IconLogout size={20} /></span>
              <span className="app-nav__label">Salir</span>
            </button>
          </nav>
        </>
      )}

      <div className="app-body">
        <div id="contenido-principal" tabIndex={-1} className={`app-content${showActionFab ? " has-fab" : ""}`}>{children}</div>
      </div>

      {/* FAB menú (arriba-izquierda) — solo cuando el drawer está cerrado. */}
      {hasNav && !navOpen && (
        <button type="button" className="ds-btn ds-btn--black ds-btn--icon fab fab--menu" onClick={() => setNavOpen(true)} aria-label="Abrir menú">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
      )}

      {/* FAB de la acción principal del rol (abajo-derecha). No en su propia
          pantalla ni en flujos de creación (ahí ya hay barra de acciones). */}
      {showActionFab && meta.action && (
        <button type="button" className="ds-btn ds-btn--green fab fab--action" onClick={() => router.push(meta.action!.href)}>
          <IconPlus size={20} /><span>{meta.action.label}</span>
        </button>
      )}

      {/* Confirmar cierre de sesión (DS ConfirmDialog). */}
      {logoutOpen && (
        <ConfirmDialog title="Cerrar sesión" message="¿Seguro que querés salir de tu sesión?"
          confirmLabel="Salir" cancelLabel="Quedarme" tone="red"
          onConfirm={cerrarSesion} onCancel={() => setLogoutOpen(false)} />
      )}
    </div>
  );
}

export { ROLE_META };
