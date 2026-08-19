"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, ConfirmDialog, Modal } from "@/components/ui";
import type { Role, Notificacion } from "@/lib/types";
import { devolucionesPendientes, formatDate } from "@/lib/helpers";
import { helpForPath } from "@/lib/help";
import {
  IconBell, IconList, IconReceipt, IconCheck, IconDelivery, IconFolder,
  IconPlus, IconLogout, IconBox, IconWarning, IconDashboard, IconEdit, IconMatrix,
} from "@/components/icons";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Íconos de tema (sol/luna). SVG inline como la hamburguesa/cerrar del riel.
const IconMoon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
const IconSun = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

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
      { href: "/proveeduria/reportes", label: "Reportes", icon: IconMatrix },
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
  const { role: current, setRole, usuario, setUsuario, pedidos, ordenes, notificaciones, marcarNotifsLeidas, marcarNotifLeida, hydrated, errorCarga, cargando, recargar } = useStore();
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
  const [helpOpen, setHelpOpen] = useState(false); // panel ⓘ "qué es esta pantalla"
  // Tema (claro/oscuro). El valor real vive en <html data-theme>; el script
  // no-flash del layout lo fija antes de pintar. Aquí solo lo reflejamos/alternamos.
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const isMobile = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
  const closeNavOnMobile = () => { if (isMobile()) setNavOpen(false); };
  useEffect(() => {
    setPinned(localStorage.getItem("adelante_oc_navpin") === "1");
    const t = (document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light";
    setTheme(t);
    setReady(true);
  }, []);
  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("adelante_oc_theme", next); } catch {}
      return next;
    });
  }
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
  // Punto rojo del menú: avisos que salen del DATO, no de que el usuario los "lea"
  // (al revés de la campanita). Hoy solo Devoluciones: se prende mientras haya algo
  // por corregir y se apaga solo cuando la última se arregla.
  const avisos = useMemo<Record<string, number>>(() => ({
    "/proveeduria/devoluciones": devolucionesPendientes(role, pedidos, ordenes),
  }), [role, pedidos, ordenes]);
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
    else if (current !== role) router.replace(ROLE_META[current]?.home ?? "/");
  }, [current, role, router, hydrated]);

  if (!hydrated || current !== role) {
    return <div className="page"><div className="empty">Cargando…</div></div>;
  }

  const meta = ROLE_META[role];
  const hasNav = meta.nav.length > 1;
  // Total para el FAB de móvil: SOLO de las secciones que este rol tiene en el menú
  // (si no, Bodega vería un punto rojo que no lleva a ninguna parte).
  const avisosTotal = meta.nav.reduce((n, item) => n + (avisos[item.href] ?? 0), 0);
  // FAB de acción visible → el contenido necesita espacio inferior para no quedar tapado.
  // No en su propia pantalla, ni en flujos de creación/edición, ni en la vista de
  // impresión (ahí el FAB verde se monta encima del documento del proveedor).
  const showActionFab = !!meta.action && pathname !== meta.action.href
    && !pathname.includes("/nueva") && !pathname.endsWith("/imprimir") && !pathname.endsWith("/editar");
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
          {/* Ayuda de la pantalla (qué es / para qué sirve) */}
          <button type="button" className="notif-bell ds-tip" data-tip="Qué es esta pantalla" title="Qué es esta pantalla"
            onClick={() => setHelpOpen(true)} aria-label="Ayuda de esta pantalla" aria-haspopup="dialog">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
          </button>
          {/* Campanita de notificaciones */}
          <div style={{ position: "relative" }}>
            <button className="notif-bell ds-tip" data-tip="Notificaciones" title="Notificaciones" onClick={toggleNotif} aria-label="Notificaciones" aria-haspopup="menu" aria-expanded={notifOpen}>
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
              {/* Desktop: hamburguesa que abre/cierra el riel (binario). Siempre visible. */}
              <button type="button" className="app-nav__burger"
                onClick={() => setPinned((p) => !p)}
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
            <span className="app-nav__section app-nav__label">Menú</span>
            {meta.nav.map((n) => {
              const Icon = n.icon;
              const active = activeHref === n.href;
              const aviso = avisos[n.href] ?? 0;
              // Con aviso, el nombre accesible/tooltip dice cuántas hay: el punto
              // solo no le sirve a quien usa lector de pantalla.
              const rotulo = aviso > 0 ? `${n.label} · ${aviso} sin corregir` : n.label;
              return (
                <button key={n.href} className={`app-nav__item${active ? " is-active" : ""}`}
                  title={rotulo} aria-label={aviso > 0 ? rotulo : undefined}
                  onClick={() => { router.push(n.href); closeNavOnMobile(); }} aria-current={active ? "page" : undefined}>
                  <span className="app-nav__ic"><Icon size={20} />{aviso > 0 && <span className="app-nav__dot" aria-hidden />}</span>
                  <span className="app-nav__label">{n.label}</span>
                </button>
              );
            })}

            {/* Pie del sidebar: cambio de tema + tarjeta de usuario + salir. */}
            <div className="app-nav__foot">
              <button type="button" className="app-nav__item app-nav__theme" onClick={toggleTheme}
                title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                aria-pressed={theme === "dark"}>
                <span className="app-nav__ic">{theme === "dark" ? <IconSun /> : <IconMoon />}</span>
                <span className="app-nav__label">{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span>
                <span className={`app-nav__switch${theme === "dark" ? " is-on" : ""} app-nav__label`} aria-hidden><i /></span>
              </button>

              <div className="app-nav__user">
                <span className="app-nav__avatar">{(usuario ?? meta.persona).slice(0, 2).toUpperCase()}</span>
                <span className="app-nav__user-meta app-nav__label">
                  <span className="app-nav__user-name">{cap(usuario ?? meta.persona)}</span>
                  <span className="app-nav__user-role">{meta.label}</span>
                </span>
                <button type="button" className="app-nav__logout app-nav__label" title="Salir"
                  onClick={() => { setNavOpen(false); setLogoutOpen(true); }} aria-label="Cerrar sesión">
                  <IconLogout size={20} />
                </button>
              </div>
            </div>
          </nav>
        </>
      )}

      <div className="app-body">
        <div id="contenido-principal" tabIndex={-1} className={`app-content${showActionFab ? " has-fab" : ""}`}>
          {/* Si no se pudieron traer los datos, avisarlo: si no, la app se ve vacía
              y parece que no hay pedidos/órdenes (era solo un console.error). */}
          {errorCarga && (
            <div className="ds-callout ds-callout--red carga-error" role="alert">
              <span className="ds-callout__icon"><IconWarning size={18} /></span>
              <div style={{ flex: 1 }}>
                <div className="ds-callout__title">No se pudieron cargar los datos</div>
                <div className="ds-callout__body">Lo que ves puede estar incompleto o desactualizado.</div>
                <div className="ds-label ds-muted" style={{ marginTop: 2 }}>{errorCarga}</div>
              </div>
              <Button variant="outline" size="sm" disabled={cargando} onClick={() => { void recargar(); }}>
                {cargando ? "Reintentando…" : "Reintentar"}
              </Button>
            </div>
          )}
          {children}
        </div>
      </div>

      {/* FAB menú (arriba-izquierda) — solo cuando el drawer está cerrado. Lleva el
          mismo punto rojo que el ítem del menú: con el drawer cerrado el ítem no se ve. */}
      {hasNav && !navOpen && (
        <button type="button" className="ds-btn ds-btn--black ds-btn--layout-icon fab fab--menu" onClick={() => setNavOpen(true)}
          aria-label={avisosTotal > 0 ? `Abrir menú · ${avisosTotal} sin corregir` : "Abrir menú"}>
          {avisosTotal > 0 && <span className="app-nav__dot" aria-hidden />}
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

      {/* Ayuda contextual: qué es la pantalla actual y para qué sirve. */}
      {helpOpen && (() => {
        const h = helpForPath(pathname);
        return (
          <Modal title={h.titulo} onClose={() => setHelpOpen(false)} wide>
            <p className="ds-muted" style={{ lineHeight: 1.5, marginBottom: "var(--ds-space-5)" }}>{h.resumen}</p>
            <div className="help-sec">
              <h4 className="help-sec__h">Para qué sirve</h4>
              <ul className="help-list">
                {h.detalle.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
            {h.pasos && h.pasos.length > 0 && (
              <div className="help-sec">
                <h4 className="help-sec__h">Paso a paso</h4>
                <ol className="help-steps">
                  {h.pasos.map((p, i) => <li key={i}>{p}</li>)}
                </ol>
              </div>
            )}
            {h.tips && h.tips.length > 0 && (
              <div className="help-sec">
                <h4 className="help-sec__h">Tips</h4>
                <ul className="help-list help-list--tips">
                  {h.tips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
          </Modal>
        );
      })()}

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
