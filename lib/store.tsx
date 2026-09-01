"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type {
  Almacen, Articulo, Maquina, Movimiento, Notificacion, Obra, Orden, OrdenLinea, Pedido, PedidoLinea,
  Proveedor, Recepcion, RecepcionLinea, Role, TipoSolicitud,
  NotaCreditoLinea, MotivoNC,
} from "./types";
import * as seed from "./seed";
import { devolverPendienteAPedidos, nextNumero, nowISO, ordenEstaCompleta, PERSONA_POR_ROL, todayISO } from "./helpers";
import { api, USE_API as USE_API_BUILD } from "./api";
import { instalarGuardFetch, EVENTO_SESION_VENCIDA } from "./fetch-guard";

export interface NewPedidoInput {
  tipoSolicitud: TipoSolicitud;
  obraCodigo?: string;
  obraNombre?: string;
  maquinaNo?: string;
  maquinaNombre?: string;
  idClasificacion?: number | null;
  solicitante: string;
  prioridad: Pedido["prioridad"];
  notas?: string;
  loteRef?: string;
  lineas: Omit<PedidoLinea, "id" | "cantidadOrdenada">[];
}

interface NewOrdenInput {
  proveedorId: string;
  proveedorNo?: string;        // código BC (PROV-…) — se guarda en SQL (col 20 chars)
  proveedorNombre?: string;
  currencyCode: string;
  fechaRecepEsperada?: string;
  bcNumber?: string;           // Nº del Pedido creado en BC (si se envió a aprobación con BC)
  bcDeepLink?: string;         // link directo al Pedido en BC
  almacenRecepcion?: string;   // almacén/ubicación de recepción en BC (default ALM-GRAL)
  observaciones?: string;      // notas para el proveedor; salen en el PDF de la orden
  notaInterna?: string;        // comentario para el APROBADOR; nunca sale en el PDF
  lineas: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[];
}

// Foto ya comprimida por el navegador (ver lib/foto.ts) lista para subir.
export interface FotoParaSubir {
  mime: string; base64: string; dataUrl: string; ancho: number; alto: number; tamano: number;
}

interface RegistrarRecepcionInput {
  ordenId: string;
  numeroFactura: string;
  fechaFactura: string;
  fechaRecepcion: string;
  fechaRegistro: string;
  total: number;
  lineas: RecepcionLinea[];
  // MODO 2: recibir el material dejando la factura EN REVISIÓN (sin registrarla).
  facturaEnRevision?: boolean;
  // Bodega avisa a Contabilidad (Kattya) que esta factura trae un cargo de
  // producto adicional (flete u otro) para que ella lo agregue. Se recibe y
  // registra la factura igual; esto solo dispara la notificación.
  cargoAviso?: { nota: string; monto?: number };
  // CONCILIACIÓN con BC: la recepción se guarda acá SIN postear en BC porque BC ya
  // la tenía (factura ya registrada allá, o pedido ya completado y borrado). El
  // texto va a la bitácora: sin él, esa recepción se ve igual que cualquier otra.
  nota?: string;
  // N.º de la factura que quedó registrada EN BC (lo devuelve BC al registrar).
  bcFacturaNo?: string;
}

interface StoreShape {
  role: Role | null;
  setRole: (r: Role | null) => void;
  usuario: string | null;
  setUsuario: (u: string | null) => void;
  cargando: boolean;
  hydrated: boolean; // ya se leyó el rol/usuario de localStorage (evita rebotar al login al recargar)
  modoApi: boolean;  // true = datos de SQL (no mock). Es el valor RUNTIME, no el de build.
  // Falló traer los datos del servidor (SQL caído, sesión vencida, red). Si no se
  // avisa, la app se ve VACÍA y parece que no hay pedidos/órdenes.
  errorCarga: string | null;
  // La sesión venció (401 en cualquier llamada). Es un estado APARTE de errorCarga
  // porque la salida es distinta —volver a entrar, no reintentar— y adivinarlo
  // leyendo el texto del error es de las cosas que se rompen solas después.
  sesionExpirada: boolean;
  // Momento (epoch ms) en que el servidor confirmó por última vez que lo que se ve
  // es lo que hay en la base. null = todavía no se ha confirmado ninguna vez.
  ultimaSync: number | null;
  recargar: () => Promise<void>;

  proveedores: Proveedor[];
  articulos: Articulo[];
  obras: Obra[];
  maquinas: Maquina[];
  almacenes: Almacen[];
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  movimientos: Movimiento[];

  addPedido: (input: NewPedidoInput) => Promise<Pedido>;
  editPedido: (id: string, input: NewPedidoInput) => Promise<void>;
  setPedidoEstado: (id: string, estado: Pedido["estado"]) => Promise<void>;
  deletePedido: (id: string) => Promise<void>;

  createOrden: (input: NewOrdenInput) => Promise<Orden>;
  // Devuelve `bcAviso` si el edit se guardó acá pero BC no pudo quedar sincronizado
  // (el pedido en BC seguiría con las líneas viejas).
  updateOrden: (id: string, input: NewOrdenInput) => Promise<{ bcAviso?: string }>;
  // Devuelve `bcAviso` cuando el cambio se hizo acá pero BC no pudo acompañarlo
  // (p.ej. reabrir con el pedido lanzado en BC): la pantalla tiene que decirlo.
  // `reabrirBc` = este cambio viene del botón "Volver a abrir" (lanzado → abierto) y
  // debe des-lanzar el pedido en BC. "Cancelar envío" NO lo manda: ahí BC no tiene
  // nada lanzado que tocar.
  setOrdenEstado: (id: string, estado: Orden["estado"], extra?: { bcNumber?: string; bcDeepLink?: string; reabrirBc?: boolean }) => Promise<{ bcAviso?: string }>;
  // Apuntar la orden a OTRO pedido de Business Central. En BC un pedido no se
  // corrige: se borra y se crea otro, y la orden se queda hablando con un número que
  // ya no existe. El servidor verifica que el nuevo exista antes de guardarlo.
  corregirBcNumber: (id: string, bcNumber: string, motivo: string) => Promise<{ bcAviso?: string }>;

  // Cerrar una orden LANZADA que ya no va a recibir el resto del material. Con
  // `devolverSaldo` (default true) lo no recibido vuelve a las solicitudes para
  // poder comprarlo de nuevo; si no, esas unidades quedan consumidas para siempre.
  cerrarOrden: (id: string, motivo: string, devolverSaldo?: boolean) => Promise<{ pendienteDevuelto: number }>;
  // Descartar un borrador de orden (Abierta y sin N.º de BC): la orden desaparece y
  // su material vuelve a quedar pendiente en la solicitud.
  descartarOrden: (id: string, motivo: string) => Promise<{ numero: string; saldoDevuelto: number }>;
  // Cierra la orden y arma una nueva (abierta) con lo que quedó pendiente.
  nuevaOrdenConPendiente: (id: string, motivo: string) => Promise<{ id: string; numero: string }>;

  registrarRecepcion: (input: RegistrarRecepcionInput) => Promise<Recepcion>;
  // Foto(s) de la factura física de una recepción ya registrada. Devuelve
  // cuántas quedaron guardadas (0 = no se pudo, la pantalla avisa).
  guardarFotosRecepcion: (recepcionId: string, fotos: FotoParaSubir[]) => Promise<number>;
  // MODO 2: registrar la factura de una recepción que quedó EN REVISIÓN (Kattya).
  facturarRecepcion: (recepcionId: string, numeroFactura: string) => Promise<void>;

  // Devuelve al ingeniero las LÍNEAS elegidas de una solicitud. El pedido entero
  // pasa a "Devuelto" solo si no le queda ninguna línea viva (lo decide el server).
  devolverPedido: (id: string, motivo: string, lineaIds: string[]) => Promise<{ devueltas: number; pedidoDevuelto: boolean }>;
  // Devolver al ingeniero líneas que YA están en una orden (Abierta/Rechazada): la
  // línea sale de la orden, el saldo vuelve a la solicitud y queda marcada devuelta.
  devolverLineasOrden: (idOrden: string, motivo: string, lineaIds: string[]) => Promise<{ devueltas: number; ordenDescartada: boolean; bcAviso?: string }>;
  // Copiar a las líneas el IVA que BC va a contabilizar (el de la app es un estimado
  // que no viaja a BC): así el total de la orden, el del PDF y el del aprobador dejan
  // de estar cortos o largos. Solo en modo API: sin BC no hay de dónde copiarlo.
  alinearIvaConBc: (idOrden: string) => Promise<{ cambiadas: number; detalle: string[] }>;
  devolverOrden: (id: string, motivo: string) => Promise<void>;

  // Notas de crédito (Bodega): líneas de factura con problema para emitir NC.
  notasCredito: NotaCreditoLinea[];
  marcarNotasCredito: (ordenId: string, ordenNumero: string, proveedor: string | undefined, items: { ordenLineaId?: string; articuloNo?: string; descripcion: string; motivo: MotivoNC; cantidad: number; precioUnitario?: number; nota?: string }[]) => Promise<void>;
  cargarNotasCredito: () => Promise<void>;
  // Contabilidad cierra la línea cuando ya emitió la NC (o la reabre si se equivocó).
  resolverNotaCredito: (id: string, resuelta: boolean) => Promise<void>;

  // Notificaciones in-app
  notificaciones: Notificacion[];
  marcarNotifsLeidas: () => void;
  marcarNotifLeida: (id: string) => void;

  borrador: { pedidoLineaId: string; cantidad: number; precio: number; iva: number }[];
  setBorrador: (items: StoreShape["borrador"]) => void;

  reset: () => void;
}

const StoreCtx = createContext<StoreShape | null>(null);
const LS_KEY = "adelante_oc_state_v3";

interface Persisted {
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  movimientos: Movimiento[];
  notificaciones: Notificacion[];
}

// `vacio` = modo API (datos de SQL). En ese modo NO se siembra NADA de demo.
//
// Por qué importa: la semilla existe para el modo mock, pero se usaba también en
// modo API como estado inicial. Si el bootstrap fallaba (sesión vencida, base
// dormida), la pantalla quedaba mostrando pedidos y montos INVENTADOS —₡2.125.000
// de "FERRETERIA EPA"— con un aviso chiquito que decía "puede estar
// desactualizado". Datos falsos con cara de reales es peor que una pantalla vacía:
// ahora, si no hay datos del servidor, no hay números.
function freshData(vacio = false): Persisted {
  if (vacio) return { notificaciones: [], pedidos: [], ordenes: [], recepciones: [], movimientos: [] };
  return {
    notificaciones: [],
    pedidos: structuredClone(seed.pedidos),
    ordenes: structuredClone(seed.ordenes),
    recepciones: structuredClone(seed.recepciones),
    movimientos: structuredClone(seed.movimientos),
  };
}

// El guard de /api/* se instala al IMPORTAR el store (antes de que cualquier
// pantalla monte y dispare su primer fetch). Ver lib/fetch-guard.ts.
if (typeof window !== "undefined") instalarGuardFetch();

// Mensaje corto y legible para el usuario a partir de un error de red/API.
function mensajeError(e: unknown): string {
  const raw = String((e as any)?.message ?? e ?? "").trim();
  if (!raw || /failed to fetch|networkerror|load failed/i.test(raw)) return "No hay conexión con el servidor.";
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}

export function StoreProvider({ children, useApi }: { children: React.ReactNode; useApi?: boolean }) {
  // Modo SQL vs mock. Preferimos el valor RUNTIME (env `USE_API`, pasado por el
  // layout del server); si no viene, caemos al flag de build (NEXT_PUBLIC_USE_API).
  const USE_API = useApi ?? USE_API_BUILD;
  const [role, setRole] = useState<Role | null>(null);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [data, setData] = useState<Persisted>(() => freshData(USE_API));
  const [borrador, setBorrador] = useState<StoreShape["borrador"]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [cargando, setCargando] = useState(USE_API);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // Cuándo se confirmó por última vez que lo que se ve es lo que hay en la base.
  // Se muestra en la barra superior: "al día" no puede ser un acto de fe.
  const [ultimaSync, setUltimaSync] = useState<number | null>(null);
  const [sesionExpirada, setSesionExpirada] = useState(false);
  // Notas de crédito (aparte del bootstrap para no romper la carga si la tabla no existe).
  const [notasCredito, setNotasCredito] = useState<NotaCreditoLinea[]>([]);
  // Firma del último bootstrap, para no re-renderizar cuando el poll trae lo mismo.
  const ultimoBootstrap = useRef<string>("");
  // Íd. para las notas de crédito, que se refrescan junto con el bootstrap.
  const ultimaNc = useRef<string>("");
  // Fallos seguidos del auto-refresh: uno suelto puede ser la red, dos ya hay que avisarlo.
  const fallosSeguidos = useRef(0);

  // hidratación
  useEffect(() => {
    // Validar el rol persistido: versiones anteriores tenían roles hoy inexistentes
    // ("aprobacion"/"ingenieria"). Un valor obsoleto cacheado hacía que el shell
    // leyera ROLE_META[rolInválido] === undefined y se cayera al error boundary al
    // recargar. Si el rol guardado no es válido, se ignora y se limpia (→ login).
    const ROLES_VALIDOS: Role[] = ["proveeduria", "facturacion", "contabilidad"];
    const r = localStorage.getItem("adelante_oc_role");
    if (r && ROLES_VALIDOS.includes(r as Role)) setRole(r as Role);
    else if (r) localStorage.removeItem("adelante_oc_role");
    const u = localStorage.getItem("adelante_oc_usuario");
    if (u) setUsuario(u);
    if (USE_API) {
      // Los datos NO se piden acá, sino en el efecto de abajo (en cuanto hay rol).
      // Sin rol no hay nadie adentro (pantalla de login) y pedir el bootstrap ahí
      // solo podía terminar en 401: encima disparaba el manejo de "sesión vencida"
      // y le borraba a la URL el ?next= con el que el middleware nos trajo.
      if (!(r && ROLES_VALIDOS.includes(r as Role))) setCargando(false);
    } else {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) setData({ ...freshData(), ...JSON.parse(raw) } as Persisted); // merge: rellena llaves nuevas
      } catch { /* ignore */ }
    }
    setHydrated(true);
  }, []);

  // Carga de datos: arranca en cuanto hay ALGUIEN adentro (rol) y no se ha traído
  // nada todavía. Cubre los dos caminos con el mismo código:
  //   · recargar la página con sesión abierta (el rol sale de localStorage), y
  //   · el momento justo después del login, donde antes no se pedía nada y la
  //     pantalla se quedaba como estuviera hasta que corriera el poll de 45 s.
  useEffect(() => {
    if (!USE_API || !hydrated || !role || ultimaSync) return;
    setCargando(true);
    refreshFromApi()
      .catch((e) => { console.error("bootstrap", e); setErrorCarga(mensajeError(e)); })
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, role, ultimaSync]);

  // Sesión vencida (la avisa lib/fetch-guard.ts ante cualquier 401): se deja de
  // fingir que hay alguien logueado. Sin esto, la app seguía pintando el nombre y
  // el menú del rol mientras NADA cargaba — exactamente la pantalla que había que
  // eliminar. El guard además manda al login guardando a dónde volver.
  useEffect(() => {
    const alVencer = () => {
      setSesionExpirada(true);
      setRole(null);
      setUsuario(null);
      setData(freshData(USE_API));
      setNotasCredito([]);
      setErrorCarga("Tu sesión venció. Iniciá sesión otra vez.");
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, alVencer);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, alVencer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh (modo API): recarga los datos SOLA, sin tener que recargar la
  // página a mano. Así los pedidos creados en Producción aparecen en Proveeduría
  // (comparten la misma base). Poll cada 45s con la pestaña visible + refresco al
  // volver a la pestaña (instantáneo al cambiar de app). No corre oculta (ahorra).
  useEffect(() => {
    if (!USE_API || !hydrated || !role) return;
    const refrescar = () => {
      if (document.hidden) return;
      refreshFromApi()
        .then(() => { fallosSeguidos.current = 0; })
        .catch((e) => {
          // Si el refresco falla en silencio (sesión vencida, SQL caído), la pantalla
          // se queda vieja sin decir nada y la gente le da refresh a mano sin saber
          // por qué. Un fallo puede ser un bache de red; dos seguidos se avisan.
          if (++fallosSeguidos.current >= 2) setErrorCarga(mensajeError(e));
        });
    };
    const id = setInterval(refrescar, 45000);
    document.addEventListener("visibilitychange", refrescar);
    window.addEventListener("focus", refrescar);
    // Volver con atrás/adelante restaura la página desde el bfcache: no dispara
    // focus ni visibilitychange, así que sin esto se veía data congelada.
    window.addEventListener("pageshow", refrescar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refrescar);
      window.removeEventListener("focus", refrescar);
      window.removeEventListener("pageshow", refrescar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, role]);

  // Al cambiar de pantalla, resincronizar. Es el momento en que la gente espera ver
  // lo nuevo (entra a "Órdenes" a ver si ya le llegó algo) y donde antes tenía que
  // recargar a mano si el poll de 45s todavía no había corrido.
  const pathname = usePathname();
  const pathAnterior = useRef<string | null>(null);
  useEffect(() => {
    if (!USE_API || !hydrated || !role) return;
    // La primera vez no: la carga inicial ya trajo los datos recién.
    if (pathAnterior.current === null || pathAnterior.current === pathname) { pathAnterior.current = pathname; return; }
    pathAnterior.current = pathname;
    refreshFromApi().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hydrated, role]);

  // persistencia local solo en modo mock
  useEffect(() => {
    if (!hydrated || USE_API) return;
    // Las fotos de factura NO se guardan acá: un dataURL de 300 KB por foto
    // revienta la cuota de localStorage (~5 MB) y dejaría la app sin poder
    // guardar nada más. En modo demo viven solo en memoria; en producción
    // (USE_API) están en la BD y se piden por su ruta.
    const sinFotos = { ...data, recepciones: data.recepciones.map((r) => (r.fotos ? { ...r, fotos: undefined } : r)) };
    localStorage.setItem(LS_KEY, JSON.stringify(sinFotos));
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (role) localStorage.setItem("adelante_oc_role", role);
    else localStorage.removeItem("adelante_oc_role");
    if (usuario) localStorage.setItem("adelante_oc_usuario", usuario);
    else localStorage.removeItem("adelante_oc_usuario");
  }, [role, usuario, hydrated]);

  async function refreshFromApi() {
    const b = await api.bootstrap();
    setErrorCarga(null);   // volvió a responder: se limpia el aviso
    setSesionExpirada(false);
    setUltimaSync(Date.now());
    // null = el servidor contestó 304: nada cambió desde la última vez. No bajó
    // cuerpo, no hay nada que comparar ni que volver a pintar. Es el caso NORMAL
    // del poll de 45 s (y el que ahorra datos móviles y batería).
    if (!b) return;
    // Segunda red: aunque el servidor haya mandado 200, si el contenido es igual al
    // que ya teníamos no se toca el estado (no se re-renderiza la app entera por
    // gusto). Comparar el JSON es mucho más barato que el re-render.
    const firma = JSON.stringify(b);
    if (firma !== ultimoBootstrap.current) {
      ultimoBootstrap.current = firma;
      // OJO: `movimientos` NO viene en el bootstrap (el historial se pide por entidad
      // en components/timeline.tsx). Bajar la tabla entera cada 45s era carísimo.
      setData((d) => ({ ...d, pedidos: b.pedidos, ordenes: b.ordenes, recepciones: b.recepciones }));
    }
    // Notas de crédito: vienen en el MISMO payload (antes eran un request aparte que
    // las pantallas pedían solo al montar, así que Contabilidad no veía una NC nueva
    // hasta recargar a mano — y un segundo viaje cada 45 s).
    const firmaNc = JSON.stringify(b.notas ?? []);
    if (firmaNc !== ultimaNc.current) { ultimaNc.current = firmaNc; setNotasCredito(b.notas ?? []); }
  }

  // Reintento manual desde el aviso de error (no recarga la página).
  async function recargar() {
    if (!USE_API) return;
    setCargando(true);
    try { await refreshFromApi(); }
    catch (e) { setErrorCarga(mensajeError(e)); }
    finally { setCargando(false); }
  }

  const api2 = useMemo<StoreShape>(() => {
    const uid = () => Math.random().toString(36).slice(2, 9);
    const persona = usuario ?? (role ? PERSONA_POR_ROL[role] : "Sistema");
    const rolActual: Role = role ?? "proveeduria";
    const mkMov = (m: Omit<Movimiento, "id" | "usuario" | "rol" | "fecha">): Movimiento =>
      ({ id: uid(), usuario: persona, rol: rolActual, fecha: nowISO(), ...m });
    const mkNotif = (tipo: Notificacion["tipo"], mensaje: string, href?: string, rol?: string): Notificacion =>
      ({ id: uid(), tipo, mensaje, fecha: nowISO(), leida: false, href, rol });
    const prov = (id: string) => seed.proveedores.find((p) => p.id === id);

    // ---------------- ADD PEDIDO ----------------
    const addPedido: StoreShape["addPedido"] = async (input) => {
      if (USE_API) {
        const { idPedidoCompra } = await api.createPedido({
          tipoSolicitud: input.tipoSolicitud, obra: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, idClasificacion: input.idClasificacion ?? null,
          solicitante: input.solicitante, prioridad: input.prioridad,
          notas: input.notas, usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({ itemNo: l.articuloId, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen, variantCode: l.variantCode })),
        });
        const p = await api.getPedido(String(idPedidoCompra));
        await refreshFromApi();
        return p;
      }
      let created!: Pedido;
      setData((d) => {
        const numero = nextNumero("PED", d.pedidos.map((p) => p.numero));
        created = {
          id: uid(), numero, tipoSolicitud: input.tipoSolicitud,
          obraCodigo: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, maquinaNombre: input.maquinaNombre,
          idClasificacion: input.idClasificacion ?? null,
          solicitante: input.solicitante, fecha: todayISO(), estado: "borrador",
          prioridad: input.prioridad, notas: input.notas, loteRef: input.loteRef,
          lineas: input.lineas.map((l) => ({ ...l, id: uid(), cantidadOrdenada: 0 })),
        };
        const mov = mkMov({ entidad: "pedido", idEntidad: created.id, documentoNo: created.numero, tipoMovimiento: "creado", estadoNuevo: "borrador", detalle: `${created.lineas.length} línea(s)` });
        const notif = mkNotif("pedido", `Nueva solicitud ${created.numero} de ${created.solicitante}`, `/proveeduria/solicitudes/${created.id}`, "proveeduria");
        return { ...d, pedidos: [created, ...d.pedidos], movimientos: [mov, ...d.movimientos], notificaciones: [notif, ...d.notificaciones] };
      });
      return created;
    };

    const editPedido: StoreShape["editPedido"] = async (id, input) => {
      if (USE_API) {
        await api.putPedido(id, {
          tipoSolicitud: input.tipoSolicitud, obra: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, solicitante: input.solicitante, prioridad: input.prioridad,
          notas: input.notas, usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({ itemNo: l.articuloId, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen, variantCode: l.variantCode })),
        });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prev = d.pedidos.find((x) => x.id === id);
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prev?.numero ?? "", tipoMovimiento: "editado", detalle: `Editado · ${input.lineas.length} línea(s)` });
        return {
          ...d,
          pedidos: d.pedidos.map((x) => (x.id === id ? {
            ...x, tipoSolicitud: input.tipoSolicitud, obraCodigo: input.obraCodigo, obraNombre: input.obraNombre,
            maquinaNo: input.maquinaNo, maquinaNombre: input.maquinaNombre, prioridad: input.prioridad, notas: input.notas,
            lineas: input.lineas.map((l) => ({ ...l, id: uid(), cantidadOrdenada: 0 })),
          } : x)),
          movimientos: [mov, ...d.movimientos],
        };
      });
    };

    // ---------------- SET PEDIDO ESTADO ----------------
    const setPedidoEstado: StoreShape["setPedidoEstado"] = async (id, estado) => {
      if (USE_API) {
        await api.patchPedidoEstado(id, { estado, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prevp = d.pedidos.find((x) => x.id === id);
        const tipo = estado === "aprobado" ? "aprobado" : estado === "borrador" ? "reabierto" : estado;
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prevp?.numero ?? "", tipoMovimiento: tipo, estadoAnterior: prevp?.estado, estadoNuevo: estado });
        return { ...d, pedidos: d.pedidos.map((x) => (x.id === id ? { ...x, estado } : x)), movimientos: [mov, ...d.movimientos] };
      });
    };

    const deletePedido: StoreShape["deletePedido"] = async (id) => {
      if (USE_API) {
        await api.deletePedido(id, { usuario: persona, rol: rolActual });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prevp = d.pedidos.find((x) => x.id === id);
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prevp?.numero ?? "", tipoMovimiento: "eliminado", estadoAnterior: prevp?.estado });
        return { ...d, pedidos: d.pedidos.filter((x) => x.id !== id), movimientos: [mov, ...d.movimientos] };
      });
    };

    // ---------------- CREATE ORDEN ----------------
    const createOrden: StoreShape["createOrden"] = async (input) => {
      if (USE_API) {
        const p = prov(input.proveedorId);
        const { idOrdenCompra } = await api.createOrden({
          proveedorNo: input.proveedorNo ?? p?.code ?? input.proveedorId, proveedorNombre: input.proveedorNombre ?? p?.nombre, currencyCode: input.currencyCode,
          usuario: persona, rol: rolActual, observaciones: input.observaciones, notaInterna: input.notaInterna,
          lineas: input.lineas.map((l) => ({
            tipoLinea: l.tipo, itemNo: l.articuloId, variantCode: l.variantCode, idPedidoCompraDet: l.pedidoLineaId ? Number(l.pedidoLineaId) : undefined,
            descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen,
            precioUnitario: l.precioUnitario, ivaPct: l.ivaPct, descuentoPct: l.descuentoPct, jobNo: l.proyecto, taskNo: l.taskNo,
            // El tipo de cargo (Item Charge de BC) y su reparto viajan al SQL: sin
            // esto se perdían y BC terminaba rechazando el flete.
            chargeNo: l.chargeNo, chargeMethod: l.chargeMethod,
          })),
        });
        const o = await api.getOrden(String(idOrdenCompra));
        await refreshFromApi();
        return o;
      }
      let created!: Orden;
      setData((d) => {
        const numero = nextNumero("CP", d.ordenes.map((o) => o.numero));
        const lineas: OrdenLinea[] = input.lineas.map((l) => ({ ...l, id: uid(), cantidadRecibida: 0, cantidadFacturada: 0 }));
        created = {
          id: uid(), numero, proveedorId: input.proveedorId, fecha: todayISO(),
          fechaRecepEsperada: input.fechaRecepEsperada, currencyCode: input.currencyCode,
          estado: "abierto", versionesArchivadas: 0, lineas,
          creadoPor: persona,   // en modo API lo pone el SQL (creadoPor)
          proveedorNo: input.proveedorNo, proveedorNombre: input.proveedorNombre,
          almacenRecepcion: input.almacenRecepcion, observaciones: input.observaciones, notaInterna: input.notaInterna,
          bcNumber: input.bcNumber, bcDeepLink: input.bcDeepLink,
        };
        const pedidos = d.pedidos.map((p) => {
          let touched = false;
          const ls = p.lineas.map((pl) => {
            const consumo = lineas.filter((ol) => ol.pedidoLineaId === pl.id).reduce((s, ol) => s + ol.cantidad, 0);
            if (consumo > 0) { touched = true; return { ...pl, cantidadOrdenada: pl.cantidadOrdenada + consumo }; }
            return pl;
          });
          if (!touched) return p;
          const sinSaldo = ls.every((pl) => pl.cantidadOrdenada >= pl.cantidad - 1e-9);
          return { ...p, lineas: ls, estado: (sinSaldo ? "en_orden" : "aprobado") as Pedido["estado"] };
        });
        const peds = [...new Set(lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))];
        const mov = mkMov({ entidad: "orden", idEntidad: created.id, documentoNo: created.numero, tipoMovimiento: "creado", estadoNuevo: "abierto", detalle: peds.length ? `Desde ${peds.join(", ")}` : undefined });
        const notif = mkNotif("orden", `Orden de compra ${created.numero} creada`, `/proveeduria/ordenes/${created.id}`, "aprobacion");
        return { ...d, ordenes: [created, ...d.ordenes], pedidos, movimientos: [mov, ...d.movimientos], notificaciones: [notif, ...d.notificaciones] };
      });
      return created;
    };

    // ---------------- SET ORDEN ESTADO ----------------
    // Editar una orden ABIERTA (aún no enviada/recibida): reemplaza líneas, proveedor,
    // moneda y almacén. Solo mock/local (la orden todavía no viajó a BC).
    const updateOrden: StoreShape["updateOrden"] = async (id, input) => {
      if (USE_API) {
        // Persistir el edit al SQL (antes solo cambiaba el estado local → se perdía
        // al refrescar). Reescribe líneas y reajusta el saldo del pedido en el server.
        const p = prov(input.proveedorId);
        const r = await api.updateOrden(id, {
          proveedorNo: input.proveedorNo ?? p?.code ?? input.proveedorId, proveedorNombre: input.proveedorNombre ?? p?.nombre,
          currencyCode: input.currencyCode, usuario: persona, rol: rolActual, observaciones: input.observaciones, notaInterna: input.notaInterna,
          lineas: input.lineas.map((l) => ({
            tipoLinea: l.tipo, itemNo: l.articuloId, variantCode: l.variantCode, idPedidoCompraDet: l.pedidoLineaId ? Number(l.pedidoLineaId) : undefined,
            descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen,
            precioUnitario: l.precioUnitario, ivaPct: l.ivaPct, descuentoPct: l.descuentoPct, jobNo: l.proyecto, taskNo: l.taskNo,
            // El tipo de cargo (Item Charge de BC) y su reparto viajan al SQL: sin
            // esto se perdían y BC terminaba rechazando el flete.
            chargeNo: l.chargeNo, chargeMethod: l.chargeMethod,
          })),
        }) as { bcAviso?: string } | undefined;
        await refreshFromApi();
        return { bcAviso: r?.bcAviso };
      }
      setData((d) => {
        const prevo = d.ordenes.find((o) => o.id === id);
        // Conservar recibido/facturado (y el id) de la línea previa que corresponda,
        // para NO perder la trazabilidad al editar.
        const prevLines = [...(prevo?.lineas ?? [])];
        const lineas: OrdenLinea[] = input.lineas.map((l) => {
          const idx = prevLines.findIndex((pl) => pl.tipo === l.tipo && pl.articuloId === l.articuloId && pl.pedidoLineaId === l.pedidoLineaId);
          const prev = idx >= 0 ? prevLines.splice(idx, 1)[0] : undefined;
          return { ...l, id: prev?.id ?? uid(), cantidadRecibida: prev?.cantidadRecibida ?? 0, cantidadFacturada: prev?.cantidadFacturada ?? 0 };
        });
        const ordenes = d.ordenes.map((o) => (o.id === id ? {
          ...o, proveedorId: input.proveedorId, proveedorNo: input.proveedorNo, proveedorNombre: input.proveedorNombre,
          currencyCode: input.currencyCode, almacenRecepcion: input.almacenRecepcion ?? o.almacenRecepcion,
          observaciones: input.observaciones ?? o.observaciones, notaInterna: input.notaInterna ?? o.notaInterna, lineas,
        } : o));
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prevo?.numero ?? "", tipoMovimiento: "editado", detalle: `${lineas.filter((l) => l.tipo === "articulo").length} línea(s)` });
        return { ...d, ordenes, movimientos: [mov, ...d.movimientos] };
      });
      return {};
    };

    const setOrdenEstado: StoreShape["setOrdenEstado"] = async (id, estado, extra) => {
      if (USE_API) {
        const r = await api.patchOrdenEstado(id, { estado, usuario: persona, rol: rolActual, bcNumber: extra?.bcNumber, reabrirBc: extra?.reabrirBc }) as { bcAviso?: string } | undefined;
        await refreshFromApi();
        return { bcAviso: r?.bcAviso };
      }
      setData((d) => {
        const prevo = d.ordenes.find((o) => o.id === id);
        const tipo = estado === "pendiente_aprobacion" ? "enviado_aprobacion" : estado === "lanzado" ? "aprobado_lanzado" : estado === "abierto" ? "reabierto" : estado === "completado" ? "completado" : estado;
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prevo?.numero ?? "", tipoMovimiento: tipo, estadoAnterior: prevo?.estado, estadoNuevo: estado, detalle: extra?.bcNumber ? `BC ${extra.bcNumber}` : undefined });
        return { ...d, ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, estado, bcNumber: extra?.bcNumber ?? o.bcNumber, bcDeepLink: extra?.bcDeepLink ?? o.bcDeepLink } : o)), movimientos: [mov, ...d.movimientos] };
      });
      return {};
    };

    const corregirBcNumber: StoreShape["corregirBcNumber"] = async (id, bcNumber, motivo) => {
      const nuevo = bcNumber.trim().toUpperCase();
      if (USE_API) {
        const r = await api.corregirBcNumber(id, { corregirBcNumber: nuevo, motivo, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return { bcAviso: r?.bcAviso };
      }
      setData((d) => {
        const prevo = d.ordenes.find((o) => o.id === id);
        const mov = mkMov({
          entidad: "orden", idEntidad: id, documentoNo: prevo?.numero ?? "", tipoMovimiento: "bc_renumerado",
          detalle: `N.º de Business Central: ${prevo?.bcNumber || "(ninguno)"} → ${nuevo}${motivo ? ` · Motivo: ${motivo}` : ""}`,
        });
        return { ...d, ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, bcNumber: nuevo } : o)), movimientos: [mov, ...d.movimientos] };
      });
      return {};
    };

    // ---------------- CERRAR ORDEN / PASAR EL PENDIENTE ----------------
    // Descartar el BORRADOR de una orden. Existe porque crear la orden ya consume el
    // saldo de la solicitud: sin esto, una orden armada por error dejaba ese material
    // "ordenado" para siempre (no se puede borrar, ni dejar sin líneas, y "Cerrar
    // orden" es solo para las lanzadas) y tampoco se podía devolver al ingeniero.
    const descartarOrden: StoreShape["descartarOrden"] = async (id, motivo) => {
      if (USE_API) {
        const r = await api.descartarOrden(id, { motivo, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return { numero: String(r?.numero ?? ""), saldoDevuelto: Number(r?.saldoDevuelto ?? 0) };
      }
      let out = { numero: "", saldoDevuelto: 0 };
      setData((d) => {
        const o = d.ordenes.find((x) => x.id === id);
        if (!o) return d;
        out = {
          numero: o.numero,
          saldoDevuelto: o.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + l.cantidad, 0),
        };
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: o.numero, tipoMovimiento: "eliminado",
          estadoAnterior: o.estado, detalle: `Borrador descartado${motivo ? ` · Motivo: ${motivo}` : ""}` });
        return {
          ...d,
          ordenes: d.ordenes.filter((x) => x.id !== id),
          // El saldo vuelve a la solicitud: es la razón de ser de descartar.
          pedidos: devolverPendienteAPedidos(d.pedidos, { ...o, lineas: o.lineas.map((l) => ({ ...l, cantidadRecibida: 0 })) }),
          movimientos: [mov, ...d.movimientos],
        };
      });
      return out;
    };

    const cerrarOrden: StoreShape["cerrarOrden"] = async (id, motivo, devolverSaldo = true) => {
      if (USE_API) {
        const r = await api.cerrarOrden(id, { motivo, devolverSaldo, usuario: persona, rol: rolActual }) as { pendienteDevuelto?: number };
        await refreshFromApi();
        return { pendienteDevuelto: Number(r?.pendienteDevuelto ?? 0) };
      }
      let pendienteDevuelto = 0;
      setData((d) => {
        const o = d.ordenes.find((x) => x.id === id);
        if (!o) return d;
        pendienteDevuelto = o.lineas.filter((l) => l.tipo === "articulo")
          .reduce((s, l) => s + Math.max(0, l.cantidad - l.cantidadRecibida), 0);
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: o.numero, tipoMovimiento: "cerrado",
          estadoAnterior: o.estado, estadoNuevo: "completado", detalle: motivo });
        return {
          ...d,
          ordenes: d.ordenes.map((x) => (x.id === id ? { ...x, estado: "completado" as Orden["estado"] } : x)),
          pedidos: devolverSaldo ? devolverPendienteAPedidos(d.pedidos, o) : d.pedidos,
          movimientos: [mov, ...d.movimientos],
        };
      });
      return { pendienteDevuelto };
    };

    const nuevaOrdenConPendiente: StoreShape["nuevaOrdenConPendiente"] = async (id, motivo) => {
      if (USE_API) {
        const r = await api.nuevaOrdenConPendiente(id, { motivo, usuario: persona, rol: rolActual }) as { idOrden?: number; numero?: string };
        await refreshFromApi();
        return { id: String(r?.idOrden ?? ""), numero: String(r?.numero ?? "") };
      }
      let creada = { id: "", numero: "" };
      setData((d) => {
        const o = d.ordenes.find((x) => x.id === id);
        if (!o) return d;
        const pendientes = o.lineas
          .filter((l) => l.tipo === "articulo" && l.cantidad - l.cantidadRecibida > 0)
          .map((l) => ({ ...l, id: uid(), cantidad: l.cantidad - l.cantidadRecibida, cantidadRecibida: 0, cantidadFacturada: 0 }));
        if (!pendientes.length) return d;
        const numero = nextNumero("CP", d.ordenes.map((x) => x.numero));
        const nueva: Orden = {
          ...o, id: uid(), numero, fecha: todayISO(), estado: "abierto", versionesArchivadas: 0,
          lineas: pendientes, bcNumber: undefined, bcDeepLink: undefined, motivoRechazo: undefined,
        };
        creada = { id: nueva.id, numero };
        // Se devuelve el saldo por el cierre y la orden nueva lo vuelve a consumir:
        // neto cero en el pedido, pero ahora colgado de la orden que sí lo va a traer.
        const pedidos = devolverPendienteAPedidos(d.pedidos, o).map((p) => {
          let tocado = false;
          const ls = p.lineas.map((pl) => {
            const consumo = pendientes.filter((ol) => ol.pedidoLineaId === pl.id).reduce((s, ol) => s + ol.cantidad, 0);
            if (consumo <= 0) return pl;
            tocado = true;
            return { ...pl, cantidadOrdenada: pl.cantidadOrdenada + consumo };
          });
          return tocado ? { ...p, lineas: ls } : p;
        });
        const movCierre = mkMov({ entidad: "orden", idEntidad: id, documentoNo: o.numero, tipoMovimiento: "cerrado",
          estadoAnterior: o.estado, estadoNuevo: "completado", detalle: `${motivo} · el pendiente pasó a ${numero}` });
        const movNueva = mkMov({ entidad: "orden", idEntidad: nueva.id, documentoNo: numero, tipoMovimiento: "creado",
          estadoNuevo: "abierto", detalle: `Con el pendiente de ${o.numero}` });
        return {
          ...d,
          ordenes: [nueva, ...d.ordenes.map((x) => (x.id === id ? { ...x, estado: "completado" as Orden["estado"] } : x))],
          pedidos,
          movimientos: [movNueva, movCierre, ...d.movimientos],
        };
      });
      return creada;
    };

    // ---------------- REGISTRAR RECEPCION ----------------
    const registrarRecepcion: StoreShape["registrarRecepcion"] = async (input) => {
      if (USE_API) {
        const { idRecepcionCompra } = await api.createRecepcion({
          idOrdenCompra: Number(input.ordenId), numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion, fechaRegistro: input.fechaRegistro,
          total: input.total, usuario: persona, rol: rolActual, nota: input.nota, bcFacturaNo: input.bcFacturaNo,
          lineas: input.lineas.map((l) => ({ idOrdenCompraDet: Number(l.ordenLineaId), cantidadRecibida: l.cantidadRecibida })),
        });
        await refreshFromApi();
        return { id: String(idRecepcionCompra), ordenId: input.ordenId, numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion, fechaRegistro: input.fechaRegistro,
          total: input.total, lineas: input.lineas, parcial: false, facturaEnRevision: !!input.facturaEnRevision,
          bcFacturaNo: input.bcFacturaNo };
      }
      const enRevision = !!input.facturaEnRevision;
      let created!: Recepcion;
      setData((d) => {
        const orden = d.ordenes.find((o) => o.id === input.ordenId)!;
        const recibidoTotal = orden.lineas.reduce((s, l) => s + l.cantidad, 0);
        const recibidoAhora = input.lineas.reduce((s, l) => s + l.cantidadRecibida, 0);
        created = {
          id: uid(), ordenId: input.ordenId, numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion,
          fechaRegistro: input.fechaRegistro, total: input.total, lineas: input.lineas,
          parcial: recibidoAhora < recibidoTotal, facturaEnRevision: enRevision, bcFacturaNo: input.bcFacturaNo,
          recibidoPor: persona,   // en modo API lo pone el SQL (creadoPor)
        };
        let completada = false;
        const ordenes = d.ordenes.map((o) => {
          if (o.id !== input.ordenId) return o;
          const lineas = o.lineas.map((l) => {
            const rl = input.lineas.find((x) => x.ordenLineaId === l.id);
            if (!rl) return l;
            // En revisión: sube lo RECIBIDO pero NO lo facturado (se factura después).
            return { ...l, cantidadRecibida: l.cantidadRecibida + rl.cantidadRecibida, cantidadFacturada: l.cantidadFacturada + (enRevision ? 0 : rl.cantidadRecibida) };
          });
          const upd = { ...o, lineas };
          completada = !enRevision && ordenEstaCompleta(upd);
          return { ...upd, estado: (completada ? "completado" : upd.estado) as Orden["estado"] };
        });
        const detalle = (enRevision ? "Recepción (factura en revisión)" : `Factura ${input.numeroFactura}`)
          + (input.nota ? ` · ${input.nota}` : "");
        const movRec = mkMov({ entidad: "recepcion", idEntidad: created.id, documentoNo: input.numeroFactura || "(en revisión)", tipoMovimiento: enRevision ? "recibido" : "creado", detalle });
        const movOrd = mkMov({ entidad: "orden", idEntidad: input.ordenId, documentoNo: orden.numero, tipoMovimiento: completada ? "recepcion_total" : "recepcion_parcial", estadoNuevo: completada ? "completado" : orden.estado, detalle });
        const notif = enRevision
          ? mkNotif("factura", `Material recibido en ${orden.numero} — factura EN REVISIÓN (registrala en Bodega)`, `/facturacion/archivo`, "facturacion")
          : mkNotif("factura", `Factura ${input.numeroFactura} registrada en ${orden.numero}${completada ? " (orden completada)" : " (parcial)"}`, `/proveeduria/ordenes/${orden.id}`, "proveeduria");
        // Aviso a Contabilidad (Kattya) si la factura trae un cargo de producto
        // adicional que ella debe agregar.
        const notifs = [notif];
        if (input.cargoAviso) {
          const montoTxt = input.cargoAviso.monto ? ` (~₡${Number(input.cargoAviso.monto).toLocaleString("es-CR")})` : "";
          notifs.unshift(mkNotif("factura",
            `Cargo de producto por agregar en ${orden.numero} (factura ${input.numeroFactura || "en revisión"}): ${input.cargoAviso.nota}${montoTxt}`,
            `/facturacion/ver/${orden.id}`, "contabilidad"));
        }
        return { ...d, ordenes, recepciones: [created, ...d.recepciones], movimientos: [movOrd, movRec, ...d.movimientos], notificaciones: [...notifs, ...d.notificaciones] };
      });
      return created;
    };

    // ---------------- FOTO DE LA FACTURA ----------------
    // Se llama DESPUÉS de registrar la recepción (ya hay id). Si falla, la
    // pantalla avisa pero la recepción queda igual: la foto es respaldo, no
    // parte del asiento.
    const guardarFotosRecepcion: StoreShape["guardarFotosRecepcion"] = async (recepcionId, fotos) => {
      if (!fotos.length) return 0;
      if (USE_API) {
        const { guardadas } = await api.addFotosRecepcion(recepcionId, {
          fotos: fotos.map((f) => ({ mime: f.mime, base64: f.base64, ancho: f.ancho, alto: f.alto })),
          usuario: persona, rol: rolActual,
        });
        await refreshFromApi();
        return guardadas ?? 0;
      }
      // Modo demo: la imagen se queda en memoria (el dataURL NO se persiste en
      // localStorage — ver el efecto de persistencia: reventaría la cuota).
      setData((d) => ({
        ...d,
        recepciones: d.recepciones.map((r) => (r.id !== recepcionId ? r : {
          ...r,
          fotos: [...(r.fotos ?? []), ...fotos.map((f) => ({
            id: uid(), mime: f.mime, tamano: f.tamano, ancho: f.ancho, alto: f.alto, url: f.dataUrl,
          }))],
        })),
      }));
      return fotos.length;
    };

    // MODO 2 — Kattya registra la factura de una recepción que estaba EN REVISIÓN.
    // Marca la factura, sube lo FACTURADO de la orden y cierra la revisión.
    const facturarRecepcion: StoreShape["facturarRecepcion"] = async (recepcionId, numeroFactura) => {
      if (USE_API) {
        await api.setRecepcionFactura(recepcionId, { numeroFactura, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const rec = d.recepciones.find((r) => r.id === recepcionId);
        if (!rec) return d;
        const orden = d.ordenes.find((o) => o.id === rec.ordenId);
        const ordenes = d.ordenes.map((o) => {
          if (o.id !== rec.ordenId) return o;
          const lineas = o.lineas.map((l) => {
            const rl = rec.lineas.find((x) => x.ordenLineaId === l.id);
            return rl ? { ...l, cantidadFacturada: l.cantidadFacturada + rl.cantidadRecibida } : l;
          });
          const upd = { ...o, lineas };
          return { ...upd, estado: (ordenEstaCompleta(upd) ? "completado" : upd.estado) as Orden["estado"] };
        });
        const recepciones = d.recepciones.map((r) => (r.id === recepcionId ? { ...r, numeroFactura, facturaEnRevision: false } : r));
        const mov = mkMov({ entidad: "recepcion", idEntidad: recepcionId, documentoNo: numeroFactura, tipoMovimiento: "creado", detalle: `Factura ${numeroFactura} registrada (venía de revisión)` });
        const notif = mkNotif("factura", `Factura ${numeroFactura} registrada en ${orden?.numero ?? ""} (salió de revisión)`, `/proveeduria/ordenes/${rec.ordenId}`, "proveeduria");
        return { ...d, ordenes, recepciones, movimientos: [mov, ...d.movimientos], notificaciones: [notif, ...d.notificaciones] };
      });
    };

    // ---------------- DEVOLVER PEDIDO AL INGENIERO ----------------
    const devolverPedido: StoreShape["devolverPedido"] = async (id, motivo, lineaIds) => {
      if (USE_API) {
        // Persistir en el SQL compartido (antes solo cambiaba el estado local y el
        // ingeniero en Producción nunca lo veía).
        const r = await api.devolverLineasPedido(id, { lineaIds, motivo, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return { devueltas: Number(r?.devueltas ?? 0), pedidoDevuelto: !!r?.pedidoDevuelto };
      }
      const ids = new Set(lineaIds);
      let resultado = { devueltas: 0, pedidoDevuelto: false };
      setData((d) => {
        const prev = d.pedidos.find((p) => p.id === id);
        if (!prev) return d;
        // Misma regla que el server: con orden de compra hecha la línea no se devuelve.
        const lineas = prev.lineas.map((l) => (ids.has(l.id) && l.cantidadOrdenada <= 0 ? { ...l, devuelta: true } : l));
        const devueltas = lineas.filter((l, i) => l.devuelta && !prev.lineas[i].devuelta).length;
        const todo = lineas.every((l) => l.devuelta);
        resultado = { devueltas, pedidoDevuelto: todo };
        const nombres = lineas.filter((l, i) => l.devuelta && !prev.lineas[i].devuelta).map((l) => l.descripcion);
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prev.numero, tipoMovimiento: "devuelto",
          estadoAnterior: prev.estado, estadoNuevo: todo ? "devuelto" : prev.estado,
          detalle: `${todo ? "Solicitud devuelta" : `Devuelta(s) ${nombres.length} línea(s): ${nombres.join("; ")}`}${motivo ? ` · Motivo: ${motivo}` : ""}` });
        const notif = mkNotif("devuelto", `${todo ? "Tu solicitud" : `${nombres.length} línea(s) de tu solicitud`} ${prev.numero} volvió a Ingeniería${motivo ? `: ${motivo}` : ""}`, `/ingenieria/${id}`, "ingenieria");
        return {
          ...d,
          pedidos: d.pedidos.map((p) => (p.id === id ? {
            ...p, lineas,
            // Igual que en SQL, donde esto se reconstruye de la bitácora: queda
            // registrado que HUBO devolución, para poder decir después "ya la
            // corrigieron" cuando el ingeniero le quite la marca a la línea.
            devolucion: { fecha: new Date().toISOString(), motivo, lineas: nombres.join("; "), usuario: persona },
            ...(todo ? { estado: "devuelto" as Pedido["estado"], notas: motivo ? `↩ Devuelto: ${motivo}${p.notas ? ` · ${p.notas}` : ""}` : p.notas } : {}),
          } : p)),
          movimientos: [mov, ...d.movimientos],
          notificaciones: [notif, ...d.notificaciones],
        };
      });
      return resultado;
    };

    // ---------------- ALINEAR EL IVA CON BUSINESS CENTRAL ----------------
    const alinearIvaConBc: StoreShape["alinearIvaConBc"] = async (idOrden) => {
      if (!USE_API) throw new Error("Sin Business Central no hay IVA que copiar (la app está en modo de prueba).");
      const r = await api.alinearIvaConBc(idOrden, { usuario: persona, rol: rolActual });
      await refreshFromApi();
      return { cambiadas: Number(r?.cambiadas ?? 0), detalle: Array.isArray(r?.detalle) ? r.detalle : [] };
    };

    // ------- DEVOLVER AL INGENIERO LÍNEAS QUE YA ESTÁN EN UNA ORDEN ---------
    // La variante/medida/grado del material los define quien pide, no Proveeduría:
    // cuando una orden se rechaza por eso, el material vuelve al ingeniero. La línea
    // sale de la orden (devolviendo el saldo) y recién ahí se marca devuelta.
    const devolverLineasOrden: StoreShape["devolverLineasOrden"] = async (idOrden, motivo, lineaIds) => {
      if (USE_API) {
        const r = await api.devolverLineasOrden(idOrden, { lineaIds, motivo, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return { devueltas: Number(r?.devueltas ?? 0), ordenDescartada: !!r?.ordenDescartada, bcAviso: r?.bcAviso };
      }
      const ids = new Set(lineaIds);
      let out = { devueltas: 0, ordenDescartada: false as boolean, bcAviso: undefined as string | undefined };
      setData((d) => {
        const o = d.ordenes.find((x) => x.id === idOrden);
        if (!o) return d;
        const vanVolver = o.lineas.filter((l) => ids.has(l.id) && l.tipo === "articulo" && l.pedidoLineaId);
        if (!vanVolver.length) return d;
        const quedan = o.lineas.filter((l) => !ids.has(l.id));
        const sinMaterial = !quedan.some((l) => l.tipo === "articulo");
        out = { devueltas: vanVolver.length, ordenDescartada: sinMaterial, bcAviso: undefined };
        // El saldo vuelve a la solicitud SOLO por lo que se va (se arma una orden
        // "fantasma" con esas líneas y se reusa la misma función del descarte).
        const pedidosConSaldo = devolverPendienteAPedidos(d.pedidos, { ...o, lineas: vanVolver.map((l) => ({ ...l, cantidadRecibida: 0 })) });
        const idsPedidoLinea = new Set(vanVolver.map((l) => l.pedidoLineaId));
        const nombres = vanVolver.map((l) => l.descripcion);
        const pedidos = pedidosConSaldo.map((p) => {
          if (!p.lineas.some((pl) => idsPedidoLinea.has(pl.id))) return p;
          const lineas = p.lineas.map((pl) => (idsPedidoLinea.has(pl.id) ? { ...pl, devuelta: true } : pl));
          const todo = lineas.every((pl) => pl.devuelta);
          return {
            ...p, lineas,
            devolucion: { fecha: new Date().toISOString(), motivo, lineas: nombres.join("; "), usuario: persona },
            ...(todo ? { estado: "devuelto" as Pedido["estado"] } : {}),
            notas: `↩ Devuelta(s): ${nombres.join("; ")} — ${motivo}${p.notas ? ` · ${p.notas}` : ""}`,
          };
        });
        const movs = [mkMov({ entidad: "orden", idEntidad: idOrden, documentoNo: o.numero,
          tipoMovimiento: sinMaterial ? "eliminado" : "editado", estadoAnterior: o.estado,
          detalle: `${sinMaterial ? "Orden descartada · " : ""}${nombres.length} línea(s) devuelta(s) al ingeniero: ${nombres.join("; ")} · Motivo: ${motivo}` })];
        return {
          ...d,
          ordenes: sinMaterial ? d.ordenes.filter((x) => x.id !== idOrden)
            : d.ordenes.map((x) => (x.id === idOrden ? { ...x, lineas: quedan } : x)),
          pedidos,
          movimientos: [...movs, ...d.movimientos],
        };
      });
      return out;
    };

    // ---------------- DEVOLVER / DENEGAR ORDEN A PROVEEDURÍA ----------------
    // Luis Roberto (Aprobación) devuelve/deniega una orden. El motivo es
    // obligatorio (lo valida la UI) y queda en el historial + como nota de la orden.
    const devolverOrden: StoreShape["devolverOrden"] = async (id, motivo) => {
      if (USE_API) {
        await api.patchOrdenEstado(id, { estado: "rechazado", usuario: persona, rol: rolActual, motivo });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prev = d.ordenes.find((o) => o.id === id);
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prev?.numero ?? "", tipoMovimiento: "rechazado", estadoAnterior: prev?.estado, estadoNuevo: "rechazado", detalle: `Motivo: ${motivo}` });
        const notif = mkNotif("devuelto", `La orden ${prev?.numero ?? ""} fue RECHAZADA por Aprobación: ${motivo}`, `/proveeduria/ordenes/${id}`, "proveeduria");
        return {
          ...d,
          ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, estado: "rechazado" as Orden["estado"], motivoRechazo: motivo, notas: `✕ Rechazada por Aprobación: ${motivo}${o.notas ? ` · ${o.notas}` : ""}` } : o)),
          movimientos: [mov, ...d.movimientos],
          notificaciones: [notif, ...d.notificaciones],
        };
      });
    };

    // ---------------- NOTAS DE CRÉDITO ----------------
    const cargarNotasCredito: StoreShape["cargarNotasCredito"] = async () => {
      if (!USE_API) return; // en mock viven en memoria
      try { setNotasCredito(await api.listNotasCredito()); } catch { /* tabla puede no existir aún */ }
    };
    const marcarNotasCredito: StoreShape["marcarNotasCredito"] = async (ordenId, ordenNumero, proveedor, items) => {
      const lineas = items.filter((it) => it.descripcion && it.cantidad > 0);
      if (!lineas.length) return;
      if (USE_API) {
        await api.createNotasCredito({ idOrdenCompra: Number(ordenId), usuario: persona, lineas });
        await cargarNotasCredito();
        return;
      }
      const nuevas: NotaCreditoLinea[] = lineas.map((it) => ({
        id: uid(), ordenId, ordenNumero, proveedor, ordenLineaId: it.ordenLineaId, articuloNo: it.articuloNo,
        descripcion: it.descripcion, motivo: it.motivo, cantidad: it.cantidad, precioUnitario: it.precioUnitario,
        nota: it.nota, fecha: nowISO(), estado: "pendiente",
      }));
      setNotasCredito((s) => [...nuevas, ...s]);
    };
    const resolverNotaCredito: StoreShape["resolverNotaCredito"] = async (id, resuelta) => {
      const estado = resuelta ? "resuelta" : "pendiente";
      if (USE_API) {
        await api.setNotaCreditoEstado(id, { estado, usuario: persona, rol: rolActual });
        await cargarNotasCredito();
        return;
      }
      setNotasCredito((s) => s.map((n) => (n.id === id ? { ...n, estado } : n)));
    };

    // ---------------- NOTIFICACIONES ----------------
    const marcarNotifsLeidas: StoreShape["marcarNotifsLeidas"] = () =>
      setData((d) => ({ ...d, notificaciones: d.notificaciones.map((n) => ({ ...n, leida: true })) }));
    const marcarNotifLeida: StoreShape["marcarNotifLeida"] = (id) =>
      setData((d) => ({ ...d, notificaciones: d.notificaciones.map((n) => (n.id === id ? { ...n, leida: true } : n)) }));

    const reset: StoreShape["reset"] = () => setData(freshData(USE_API));

    return {
      role, setRole, usuario, setUsuario, cargando, hydrated, modoApi: USE_API, errorCarga, sesionExpirada, ultimaSync, recargar,
      proveedores: seed.proveedores, articulos: seed.articulos, obras: seed.obras,
      maquinas: seed.maquinas, almacenes: seed.almacenes,
      pedidos: data.pedidos, ordenes: data.ordenes, recepciones: data.recepciones, movimientos: data.movimientos,
      addPedido, editPedido, setPedidoEstado, deletePedido,
      createOrden, updateOrden, setOrdenEstado, corregirBcNumber, cerrarOrden, descartarOrden, nuevaOrdenConPendiente, registrarRecepcion, guardarFotosRecepcion, facturarRecepcion, devolverPedido, devolverLineasOrden, alinearIvaConBc, devolverOrden, reset,
      notasCredito, marcarNotasCredito, cargarNotasCredito, resolverNotaCredito,
      notificaciones: data.notificaciones, marcarNotifsLeidas, marcarNotifLeida,
      borrador, setBorrador,
    };
    // OJO: TODO estado que el store exponga debe estar en estas deps o el value
    // queda "congelado" con su valor viejo — así las notas de crédito cargadas
    // por cargarNotasCredito() nunca llegaban a Contabilidad (lista vacía).
  }, [role, usuario, data, borrador, cargando, notasCredito, hydrated, errorCarga, sesionExpirada, ultimaSync]);

  return <StoreCtx.Provider value={api2}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
