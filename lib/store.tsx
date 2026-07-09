"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  Almacen, Articulo, Maquina, Movimiento, Notificacion, Obra, Orden, OrdenLinea, Pedido, PedidoLinea,
  PlanCategoria, PlanFila, Proveedor, Recepcion, RecepcionLinea, Role, TipoSolicitud,
} from "./types";
import * as seed from "./seed";
import { nextNumero, nowISO, ordenEstaCompleta, PERSONA_POR_ROL, todayISO } from "./helpers";
import { api, USE_API } from "./api";

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
  lineas: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[];
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
}

interface StoreShape {
  role: Role | null;
  setRole: (r: Role | null) => void;
  usuario: string | null;
  setUsuario: (u: string | null) => void;
  cargando: boolean;
  hydrated: boolean; // ya se leyó el rol/usuario de localStorage (evita rebotar al login al recargar)

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
  updatePedido: (p: Pedido) => void;
  setPedidoEstado: (id: string, estado: Pedido["estado"]) => Promise<void>;
  deletePedido: (id: string) => Promise<void>;

  createOrden: (input: NewOrdenInput) => Promise<Orden>;
  updateOrden: (id: string, input: NewOrdenInput) => Promise<void>;
  setOrdenEstado: (id: string, estado: Orden["estado"], extra?: { bcNumber?: string; bcDeepLink?: string }) => Promise<void>;

  registrarRecepcion: (input: RegistrarRecepcionInput) => Promise<Recepcion>;
  // MODO 2: registrar la factura de una recepción que quedó EN REVISIÓN (Kattya).
  facturarRecepcion: (recepcionId: string, numeroFactura: string) => Promise<void>;

  devolverPedido: (id: string, motivo: string) => Promise<void>;
  devolverOrden: (id: string, motivo: string) => Promise<void>;

  // Notificaciones in-app
  notificaciones: Notificacion[];
  marcarNotifsLeidas: () => void;

  // Planificación (Ingeniería)
  planCategorias: PlanCategoria[];
  planFilas: PlanFila[];
  addPlanCategoria: (nombre: string) => void;
  removePlanCategoria: (id: string) => void;
  addPlanFila: (fila: Omit<PlanFila, "id" | "valores">) => void;
  removePlanFila: (id: string) => void;
  setPlanCelda: (filaId: string, categoriaId: string, valor: string) => void;
  cargarPlanificacion: (categorias: PlanCategoria[], filas: PlanFila[]) => void;

  // Contexto transitorio: armar un pedido desde una unidad de Planificación
  planContexto: { modelo: string; lote: string } | null;
  setPlanContexto: (c: { modelo: string; lote: string } | null) => void;

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
  planCategorias: PlanCategoria[];
  planFilas: PlanFila[];
}

// Partidas de presupuesto iniciales (de la hoja "Programación" del Excel).
const PLAN_CATEGORIAS_SEED: PlanCategoria[] = [
  "MONOCOMANDO DUCHAS / BARANI", "LIVIANO", "CEMENTICIO", "REPELLOS", "granito",
  "muebles", "color muebles", "color puertas", "azulejo cocina", "ceramica",
  "pilas", "losa sanitaria", "zacate", "TAC",
].map((n, i) => ({ id: `c${i + 1}`, nombre: n }));

function freshData(): Persisted {
  return {
    notificaciones: [],
    planCategorias: structuredClone(PLAN_CATEGORIAS_SEED),
    planFilas: [],
    pedidos: structuredClone(seed.pedidos),
    ordenes: structuredClone(seed.ordenes),
    recepciones: structuredClone(seed.recepciones),
    movimientos: structuredClone(seed.movimientos),
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [data, setData] = useState<Persisted>(() => freshData());
  const [borrador, setBorrador] = useState<StoreShape["borrador"]>([]);
  const [planContexto, setPlanContexto] = useState<StoreShape["planContexto"]>(null);
  const [hydrated, setHydrated] = useState(false);
  const [cargando, setCargando] = useState(USE_API);

  // hidratación
  useEffect(() => {
    const r = localStorage.getItem("adelante_oc_role") as Role | null;
    if (r) setRole(r);
    const u = localStorage.getItem("adelante_oc_usuario");
    if (u) setUsuario(u);
    if (USE_API) {
      api.bootstrap()
        .then((b) => setData((d) => ({ ...d, pedidos: b.pedidos, ordenes: b.ordenes, recepciones: b.recepciones, movimientos: b.movimientos })))
        .catch((e) => console.error("bootstrap", e))
        .finally(() => { setCargando(false); setHydrated(true); });
    } else {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) setData({ ...freshData(), ...JSON.parse(raw) } as Persisted); // merge: rellena llaves nuevas
      } catch { /* ignore */ }
      setHydrated(true);
    }
  }, []);

  // persistencia local solo en modo mock
  useEffect(() => {
    if (!hydrated || USE_API) return;
    localStorage.setItem(LS_KEY, JSON.stringify(data));
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
    setData((d) => ({ ...d, pedidos: b.pedidos, ordenes: b.ordenes, recepciones: b.recepciones, movimientos: b.movimientos }));
  }

  const api2 = useMemo<StoreShape>(() => {
    const uid = () => Math.random().toString(36).slice(2, 9);
    const persona = usuario ?? (role ? PERSONA_POR_ROL[role] : "Sistema");
    const rolActual: Role = role ?? "ingenieria";
    const mkMov = (m: Omit<Movimiento, "id" | "usuario" | "rol" | "fecha">): Movimiento =>
      ({ id: uid(), usuario: persona, rol: rolActual, fecha: nowISO(), ...m });
    const mkNotif = (tipo: Notificacion["tipo"], mensaje: string, href?: string, rol?: Role): Notificacion =>
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

    const updatePedido: StoreShape["updatePedido"] = (p) =>
      setData((d) => ({ ...d, pedidos: d.pedidos.map((x) => (x.id === p.id ? p : x)) }));

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
          usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({
            tipoLinea: l.tipo, itemNo: l.articuloId, idPedidoCompraDet: l.pedidoLineaId ? Number(l.pedidoLineaId) : undefined,
            descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen,
            precioUnitario: l.precioUnitario, ivaPct: l.ivaPct, descuentoPct: l.descuentoPct, jobNo: l.proyecto, taskNo: l.taskNo,
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
          proveedorNo: input.proveedorNo, proveedorNombre: input.proveedorNombre,
          almacenRecepcion: input.almacenRecepcion,
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
      setData((d) => {
        const lineas: OrdenLinea[] = input.lineas.map((l) => ({ ...l, id: uid(), cantidadRecibida: 0, cantidadFacturada: 0 }));
        const prevo = d.ordenes.find((o) => o.id === id);
        const ordenes = d.ordenes.map((o) => (o.id === id ? {
          ...o, proveedorId: input.proveedorId, proveedorNo: input.proveedorNo, proveedorNombre: input.proveedorNombre,
          currencyCode: input.currencyCode, almacenRecepcion: input.almacenRecepcion ?? o.almacenRecepcion, lineas,
        } : o));
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prevo?.numero ?? "", tipoMovimiento: "editado", detalle: `${lineas.filter((l) => l.tipo === "articulo").length} línea(s)` });
        return { ...d, ordenes, movimientos: [mov, ...d.movimientos] };
      });
    };

    const setOrdenEstado: StoreShape["setOrdenEstado"] = async (id, estado, extra) => {
      if (USE_API) {
        await api.patchOrdenEstado(id, { estado, usuario: persona, rol: rolActual, bcNumber: extra?.bcNumber });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prevo = d.ordenes.find((o) => o.id === id);
        const tipo = estado === "pendiente_aprobacion" ? "enviado_aprobacion" : estado === "lanzado" ? "aprobado_lanzado" : estado === "abierto" ? "reabierto" : estado === "completado" ? "completado" : estado;
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prevo?.numero ?? "", tipoMovimiento: tipo, estadoAnterior: prevo?.estado, estadoNuevo: estado, detalle: extra?.bcNumber ? `BC ${extra.bcNumber}` : undefined });
        return { ...d, ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, estado, bcNumber: extra?.bcNumber ?? o.bcNumber, bcDeepLink: extra?.bcDeepLink ?? o.bcDeepLink } : o)), movimientos: [mov, ...d.movimientos] };
      });
    };

    // ---------------- REGISTRAR RECEPCION ----------------
    const registrarRecepcion: StoreShape["registrarRecepcion"] = async (input) => {
      if (USE_API) {
        const { idRecepcionCompra } = await api.createRecepcion({
          idOrdenCompra: Number(input.ordenId), numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion, fechaRegistro: input.fechaRegistro,
          total: input.total, usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({ idOrdenCompraDet: Number(l.ordenLineaId), cantidadRecibida: l.cantidadRecibida })),
        });
        await refreshFromApi();
        return { id: String(idRecepcionCompra), ordenId: input.ordenId, numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion, fechaRegistro: input.fechaRegistro,
          total: input.total, lineas: input.lineas, parcial: false, facturaEnRevision: !!input.facturaEnRevision };
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
          parcial: recibidoAhora < recibidoTotal, facturaEnRevision: enRevision,
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
        const detalle = enRevision ? "Recepción (factura en revisión)" : `Factura ${input.numeroFactura}`;
        const movRec = mkMov({ entidad: "recepcion", idEntidad: created.id, documentoNo: input.numeroFactura || "(en revisión)", tipoMovimiento: enRevision ? "recibido" : "creado", detalle });
        const movOrd = mkMov({ entidad: "orden", idEntidad: input.ordenId, documentoNo: orden.numero, tipoMovimiento: completada ? "recepcion_total" : "recepcion_parcial", estadoNuevo: completada ? "completado" : orden.estado, detalle });
        const notif = enRevision
          ? mkNotif("factura", `Material recibido en ${orden.numero} — factura EN REVISIÓN (registrala en Bodega)`, `/facturacion/archivo`, "facturacion")
          : mkNotif("factura", `Factura ${input.numeroFactura} registrada en ${orden.numero}${completada ? " (orden completada)" : " (parcial)"}`, `/proveeduria/ordenes/${orden.id}`, "proveeduria");
        return { ...d, ordenes, recepciones: [created, ...d.recepciones], movimientos: [movOrd, movRec, ...d.movimientos], notificaciones: [notif, ...d.notificaciones] };
      });
      return created;
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
    const devolverPedido: StoreShape["devolverPedido"] = async (id, motivo) => {
      setData((d) => {
        const prev = d.pedidos.find((p) => p.id === id);
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prev?.numero ?? "", tipoMovimiento: "devuelto", estadoAnterior: prev?.estado, estadoNuevo: "devuelto", detalle: motivo ? `Motivo: ${motivo}` : "Devuelto a Ingeniería" });
        const notif = mkNotif("devuelto", `Tu solicitud ${prev?.numero ?? ""} fue devuelta${motivo ? `: ${motivo}` : ""}`, `/ingenieria/${id}`, "ingenieria");
        return {
          ...d,
          pedidos: d.pedidos.map((p) => (p.id === id ? { ...p, estado: "devuelto" as Pedido["estado"], notas: motivo ? `↩ Devuelto: ${motivo}${p.notas ? ` · ${p.notas}` : ""}` : p.notas } : p)),
          movimientos: [mov, ...d.movimientos],
          notificaciones: [notif, ...d.notificaciones],
        };
      });
    };

    // ---------------- DEVOLVER / DENEGAR ORDEN A PROVEEDURÍA ----------------
    // Luis Roberto (Aprobación) devuelve/deniega una orden. El motivo es
    // obligatorio (lo valida la UI) y queda en el historial + como nota de la orden.
    const devolverOrden: StoreShape["devolverOrden"] = async (id, motivo) => {
      if (USE_API) {
        await api.patchOrdenEstado(id, { estado: "abierto", usuario: persona, rol: rolActual, motivo });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prev = d.ordenes.find((o) => o.id === id);
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prev?.numero ?? "", tipoMovimiento: "reabierto", estadoAnterior: prev?.estado, estadoNuevo: "abierto", detalle: `Motivo: ${motivo}` });
        const notif = mkNotif("devuelto", `La orden ${prev?.numero ?? ""} fue devuelta por Aprobación: ${motivo}`, `/proveeduria/ordenes/${id}`, "proveeduria");
        return {
          ...d,
          ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, estado: "abierto" as Orden["estado"], notas: `↩ Devuelta por Aprobación: ${motivo}${o.notas ? ` · ${o.notas}` : ""}` } : o)),
          movimientos: [mov, ...d.movimientos],
          notificaciones: [notif, ...d.notificaciones],
        };
      });
    };

    // ---------------- NOTIFICACIONES ----------------
    const marcarNotifsLeidas: StoreShape["marcarNotifsLeidas"] = () =>
      setData((d) => ({ ...d, notificaciones: d.notificaciones.map((n) => ({ ...n, leida: true })) }));

    // ---------------- PLANIFICACIÓN ----------------
    const addPlanCategoria: StoreShape["addPlanCategoria"] = (nombre) =>
      setData((d) => (nombre.trim() ? { ...d, planCategorias: [...d.planCategorias, { id: uid(), nombre: nombre.trim() }] } : d));
    const removePlanCategoria: StoreShape["removePlanCategoria"] = (cid) =>
      setData((d) => ({ ...d, planCategorias: d.planCategorias.filter((c) => c.id !== cid), planFilas: d.planFilas.map((f) => { const v = { ...f.valores }; delete v[cid]; return { ...f, valores: v }; }) }));
    const addPlanFila: StoreShape["addPlanFila"] = (fila) =>
      setData((d) => ({ ...d, planFilas: [...d.planFilas, { id: uid(), modelo: fila.modelo, lote: fila.lote, responsable: fila.responsable, valores: {} }] }));
    const removePlanFila: StoreShape["removePlanFila"] = (fid) =>
      setData((d) => ({ ...d, planFilas: d.planFilas.filter((f) => f.id !== fid) }));
    const setPlanCelda: StoreShape["setPlanCelda"] = (fid, cid, valor) =>
      setData((d) => ({ ...d, planFilas: d.planFilas.map((f) => (f.id === fid ? { ...f, valores: { ...f.valores, [cid]: valor } } : f)) }));
    const cargarPlanificacion: StoreShape["cargarPlanificacion"] = (categorias, filas) =>
      setData((d) => ({ ...d, planCategorias: categorias, planFilas: filas }));

    const reset: StoreShape["reset"] = () => setData(freshData());

    return {
      role, setRole, usuario, setUsuario, cargando, hydrated,
      proveedores: seed.proveedores, articulos: seed.articulos, obras: seed.obras,
      maquinas: seed.maquinas, almacenes: seed.almacenes,
      pedidos: data.pedidos, ordenes: data.ordenes, recepciones: data.recepciones, movimientos: data.movimientos,
      addPedido, editPedido, updatePedido, setPedidoEstado, deletePedido,
      createOrden, updateOrden, setOrdenEstado, registrarRecepcion, facturarRecepcion, devolverPedido, devolverOrden, reset,
      notificaciones: data.notificaciones, marcarNotifsLeidas,
      planCategorias: data.planCategorias, planFilas: data.planFilas,
      addPlanCategoria, removePlanCategoria, addPlanFila, removePlanFila, setPlanCelda, cargarPlanificacion,
      planContexto, setPlanContexto,
      borrador, setBorrador,
    };
  }, [role, usuario, data, borrador, planContexto, cargando]);

  return <StoreCtx.Provider value={api2}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
