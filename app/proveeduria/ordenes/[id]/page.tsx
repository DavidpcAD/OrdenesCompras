"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Checkbox, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";
import { num, ordenPendienteResumen, numeroOrden, etiquetaInterna, ordenAdmiteDevolucion, puedeDevolverLineaOrden, motivoNoDevolverLineaOrden, ordenQuedaSinMaterial, ordenEsperaCorreccion } from "@/lib/helpers";

export default function ProvOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, pedidos, recepciones, setOrdenEstado, corregirBcNumber, cerrarOrden, descartarOrden, devolverLineasOrden, alinearIvaConBc, nuevaOrdenConPendiente, cargando } = useStore();
  const [procesando, setProcesando] = useState(false);
  // Aviso de BC que NO se puede perder (el toast se desvanece y el usuario se queda
  // creyendo que el pedido en BC también se reabrió).
  const [avisoBc, setAvisoBc] = useState<string | null>(null);
  // Modal de cierre. `crearNueva` convierte el cierre en "pasar el pendiente a una
  // orden nueva": por eso obliga a devolver el saldo (la nueva lo vuelve a tomar).
  const [cerrando, setCerrando] = useState(false);
  // Descartar el borrador: la orden desaparece y su material vuelve a quedar
  // pendiente en la solicitud (es la única forma de soltar lo que una orden armada
  // por error dejó "ordenado").
  const [descartando, setDescartando] = useState(false);
  const [motivoDescarte, setMotivoDescarte] = useState("");
  // Devolver material al INGENIERO desde la orden: la variante, la medida o el grado
  // los define quien pide, así que cuando la orden se rechaza por eso el material
  // tiene que volver a sus manos (la línea sale de la orden y el saldo se libera).
  const [devolviendo, setDevolviendo] = useState(false);
  const [motivoDev, setMotivoDev] = useState("");
  const [selDev, setSelDev] = useState<Record<string, boolean>>({});
  // Apuntar la orden a otro pedido de BC. Allá un pedido no se corrige: se borra y se
  // crea otro, y la orden se queda hablando con un número que ya no existe (Bodega
  // registra y BC contesta "pedido no encontrado", una y otra vez).
  const [renumerando, setRenumerando] = useState(false);
  const [nuevoBc, setNuevoBc] = useState("");
  const [motivoBc, setMotivoBc] = useState("");
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  const [devolver, setDevolver] = useState(true);
  const [crearNueva, setCrearNueva] = useState(false);

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    // Durante la carga inicial (SQL/BC) el store aún está vacío: mostrar skeleton
    // en vez de parpadear "no encontrada".
    if (cargando) {
      return <main className="page"><div className="col gap-4" aria-busy="true">
        <Skeleton style={{ display: "block", width: 240, height: 30, borderRadius: 8 }} />
        <Skeleton style={{ display: "block", width: 360, height: 16, borderRadius: 6 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 340, borderRadius: 16, marginTop: 8 }} />
      </div></main>;
    }
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }
  // Link de cada línea a su solicitud de origen (para ver quién la pidió).
  const solicitudHref = (l: NonNullable<typeof orden>["lineas"][number]) => {
    const p = (l.pedidoLineaId && pedidos.find((x) => x.lineas.some((ln) => ln.id === l.pedidoLineaId)))
      || (l.pedidoNumero && pedidos.find((x) => x.numero === l.pedidoNumero));
    return p ? `/proveeduria/solicitudes/${p.id}` : null;
  };

  // Cambiar el estado de la orden. Si el servidor falla hay que DECIRLO: antes la
  // promesa se rechazaba sin manejar y el botón parecía no hacer nada.
  async function act(estado: NonNullable<typeof orden>["estado"], msg: string, opts?: { reabrirBc?: boolean }) {
    if (procesando) return;            // evita el doble clic
    setProcesando(true);
    try {
      const r = await setOrdenEstado(orden!.id, estado, { reabrirBc: opts?.reabrirBc });
      // Si BC no pudo acompañar el cambio, ese aviso manda sobre el "listo" — y queda
      // fijo en la pantalla, no solo como toast.
      if (r?.bcAviso) { setAvisoBc(r.bcAviso); toast(r.bcAviso, "info"); }
      else { setAvisoBc(null); toast(msg, "success"); }
    } catch (e: any) {
      // El error se QUEDA en pantalla, no solo como toast. El corte por "BC no tiene
      // lo mismo que la orden" trae el detalle línea por línea, y eso no se puede leer
      // en tres segundos: es justamente lo que hay que ir a corregir.
      const msg = String(e?.message ?? e);
      setAvisoBc(msg);
      toast(`No se pudo actualizar la orden: ${msg.split("\n")[0]}`, "error");
    } finally {
      setProcesando(false);
    }
  }

  // Con material ya recibido/facturado la orden no se reabre: en BC el pedido ya
  // tiene recepciones registradas y no se puede des-lanzar. Lo que llegó mal va por
  // devolución, no por corregir la orden.
  const tieneRecepciones = recepciones.some((r) => r.ordenId === orden.id)
    || orden.lineas.some((l) => (l.cantidadRecibida ?? 0) > 0 || (l.cantidadFacturada ?? 0) > 0);

  // Motivos típicos por los que una orden se cierra con material pendiente. El
  // motivo es obligatorio: sin él, dentro de un mes nadie sabe por qué faltó.
  const MOTIVOS = [
    "El proveedor no entregó el resto",
    "Se compró en otro lado",
    "Ya no se necesita",
    "El material se descontinuó",
    "Error en la orden",
  ];
  const pendiente = ordenPendienteResumen(orden);

  async function confirmarDescarte() {
    if (procesando) return;
    setProcesando(true);
    try {
      const r = await descartarOrden(orden!.id, motivoDescarte.trim());
      setDescartando(false);
      toast(`${numeroOrden(orden!)} descartada${r.saldoDevuelto > 0 ? ` · ${num.format(r.saldoDevuelto)} u. volvieron a la solicitud` : ""}`, "success");
      router.push("/proveeduria/ordenes");
    } catch (e: any) {
      toast(`No se pudo descartar: ${String(e?.message ?? e)}`, "error");
    } finally {
      setProcesando(false);
    }
  }

  // Líneas de esta orden que se le pueden devolver al ingeniero (material de una
  // solicitud, sin recibir ni facturar).
  const lineasDevolvibles = orden.lineas.filter(puedeDevolverLineaOrden);
  const elegidasDev = Object.entries(selDev).filter(([, v]) => v).map(([k]) => k);
  const dejaSinMaterial = elegidasDev.length > 0 && ordenQuedaSinMaterial(orden, elegidasDev);

  function abrirDevolver() {
    // Todas marcadas por defecto: lo normal es que la orden se rechace completa
    // ("falta variante" en varias líneas) y desmarcar es más rápido que marcar.
    setSelDev(Object.fromEntries(lineasDevolvibles.map((l) => [l.id, true])));
    setMotivoDev("");
    setDevolviendo(true);
  }

  async function confirmarDevolucion() {
    if (!elegidasDev.length) { toast("Marcá al menos una línea para devolver.", "error"); return; }
    if (!motivoDev.trim()) { toast("Escribí qué tiene que corregir el ingeniero.", "error"); return; }
    if (procesando) return;
    setProcesando(true);
    try {
      const r = await devolverLineasOrden(orden!.id, motivoDev.trim(), elegidasDev);
      setDevolviendo(false);
      if (r.bcAviso) setAvisoBc(r.bcAviso);
      toast(`${r.devueltas} línea(s) volvieron al ingeniero${r.ordenDescartada ? ` · ${numeroOrden(orden!)} se descartó (quedó sin material)` : ""}`, "success");
      // Sin material la orden ya no existe: quedarse en su detalle mostraría una
      // pantalla de "no encontrada".
      if (r.ordenDescartada) router.push("/proveeduria/ordenes");
    } catch (e: any) {
      toast(`No se pudo devolver: ${String(e?.message ?? e)}`, "error");
    } finally {
      setProcesando(false);
    }
  }

  // Copiar a las líneas el IVA que BC va a contabilizar (lo ofrece el aviso amarillo
  // del detalle cuando los totales no coinciden).
  async function usarIvaDeBc() {
    try {
      const r = await alinearIvaConBc(orden!.id);
      toast(r.cambiadas > 0
        ? `IVA alineado con BC en ${r.cambiadas} línea(s) · ${r.detalle.join(" · ")}`
        : "El IVA de la orden ya coincide con el de BC: no había nada que cambiar.", r.cambiadas > 0 ? "success" : "info");
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
    }
  }

  async function confirmarCierre() {
    if (!motivo) { toast("Elegí el motivo del cierre.", "error"); return; }
    if (procesando) return;
    const texto = [motivo, nota.trim()].filter(Boolean).join(" — ");
    setProcesando(true);
    try {
      if (crearNueva) {
        const n = await nuevaOrdenConPendiente(orden!.id, texto);
        setCerrando(false);
        // `n` es una orden recién creada: nunca tiene N.º de BC todavía, así que no
        // se la nombra con un número (antes el toast decía "CP-000046", un número
        // que en BC no existe). La pantalla a la que rebota ya es la de ella.
        toast(`${numeroOrden(orden!)} cerrada · se armó una orden nueva con lo pendiente`, "success");
        if (n.id) router.push(`/proveeduria/ordenes/${n.id}`);
        return;
      }
      const r = await cerrarOrden(orden!.id, texto, devolver);
      setCerrando(false);
      toast(r.pendienteDevuelto > 0
        ? `${numeroOrden(orden!)} cerrada · ${num.format(r.pendienteDevuelto)} u. sin recibir ${devolver ? "volvieron a las solicitudes" : "quedaron consumidas"}`
        : `${numeroOrden(orden!)} cerrada`, "success");
    } catch (e: any) {
      toast(`No se pudo cerrar la orden: ${String(e?.message ?? e)}`, "error");
    } finally {
      setProcesando(false);
    }
  }

  async function confirmarRenumerado() {
    const nuevo = nuevoBc.trim().toUpperCase();
    if (!nuevo) { toast("Escribí el N.º del pedido en Business Central.", "error"); return; }
    if (procesando) return;
    setProcesando(true);
    try {
      const r = await corregirBcNumber(orden!.id, nuevo, motivoBc.trim());
      setRenumerando(false);
      if (r?.bcAviso) { setAvisoBc(r.bcAviso); toast(r.bcAviso, "info"); }
      else { setAvisoBc(null); toast(`${numeroOrden(orden!)} ahora apunta a ${nuevo} en Business Central`, "success"); }
    } catch (e: any) {
      // El servidor verifica contra BC que el pedido exista: ese "no" es información,
      // no una falla, y tiene que leerse completo (dice qué confirmar y con quién).
      toast(String(e?.message ?? e), "error");
    } finally {
      setProcesando(false);
    }
  }

  // Todo su material volvió al ingeniero y la orden se quedó esperando la corrección
  // (conserva su N.º de BC). No hay nada que aprobar hasta que el material vuelva, así
  // que el botón de enviar no se ofrece: el server igual lo frena con un 409.
  const espera = ordenEsperaCorreccion(orden);

  const acciones = (
    <>
      {orden.estado === "abierto" && (
        <>
          <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/editar`)}>Editar</Button>
          {!espera && (
            <Button disabled={procesando} onClick={() => act("pendiente_aprobacion", `${numeroOrden(orden)} enviada a aprobación`)}>
              {procesando ? "Enviando…" : "Enviar a aprobación"}
            </Button>
          )}
        </>
      )}
      {/* Devolver al ingeniero: la salida para lo que Proveeduría NO decide (la
          variante, la medida, el grado). Sirve aunque la orden ya viva en BC, que es
          justo donde antes no había salida: la línea sale de la orden, el saldo
          vuelve a la solicitud y el ingeniero la ve en SU bandeja de devoluciones. */}
      {ordenAdmiteDevolucion(orden) && lineasDevolvibles.length > 0 && (
        <Button variant="outline" disabled={procesando}
          title="Devuelve material de esta orden al ingeniero para que lo corrija (la variante, la medida, el grado). La línea sale de la orden y el saldo vuelve a la solicitud."
          onClick={abrirDevolver}>
          Devolver al ingeniero
        </Button>
      )}
      {/* Descartar: solo lo que NO existe en BC. Lo que ya está allá se reabre o se
          cierra, para que el rastro quede en los dos lados. */}
      {(orden.estado === "abierto" || orden.estado === "rechazado") && !orden.bcNumber && (
        <Button variant="outline" disabled={procesando}
          title="Descarta este borrador y devuelve el material a la solicitud, para poder ordenarlo distinto o devolvérselo al ingeniero"
          onClick={() => { setMotivoDescarte(""); setDescartando(true); }}>
          Descartar borrador
        </Button>
      )}
      {orden.estado === "pendiente_aprobacion" && (
        <>
          <span className="ds-muted ds-label" style={{ alignSelf: "center" }}>En espera de aprobación de Luis Roberto</span>
          <Button variant="outline" disabled={procesando} onClick={() => act("abierto", "Solicitud de aprobación cancelada")}>Cancelar envío</Button>
        </>
      )}
      {orden.estado === "rechazado" && (
        <>
          <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/editar`)}>Editar</Button>
          {!espera && (
            <Button disabled={procesando} onClick={() => act("pendiente_aprobacion", `${numeroOrden(orden)} corregida y reenviada a aprobación`)}>
              {procesando ? "Reenviando…" : "Reenviar a aprobación"}
            </Button>
          )}
        </>
      )}
      {/* Reabrir = des-lanzar también el pedido en BC (lo hace el server): con el
          pedido lanzado allá no se puede corregir ni re-sincronizar. Si BC no pudo,
          el toast lo dice y el aviso amarillo del detalle queda visible. */}
      {orden.estado === "lanzado" && (
        <Button variant="outline" disabled={procesando || tieneRecepciones}
          title={tieneRecepciones
            ? "Ya tiene facturas/recepciones registradas: no se puede volver a abrir. Lo que llegó mal va por devolución."
            : "Reabre la orden acá y des-lanza el pedido en Business Central para corregirla y volver a enviarla a aprobación."}
          onClick={() => void act("abierto", `${numeroOrden(orden)} reabierta${orden.bcNumber ? ` · ${orden.bcNumber} des-lanzado en BC` : ""} — corregila y volvé a enviarla a aprobación`, { reabrirBc: true })}>
          Volver a abrir
        </Button>
      )}
      {/* Cerrar: la orden se da por terminada aunque falte material (el proveedor no
          lo trajo, se compró en otro lado). Distinto de reabrir, que es para corregirla. */}
      {orden.estado === "lanzado" && (
        <Button variant="outline" disabled={procesando}
          title="Dar por terminada la orden aunque quede material sin recibir"
          onClick={() => { setMotivo(""); setNota(""); setDevolver(true); setCrearNueva(false); setCerrando(true); }}>
          Cerrar orden
        </Button>
      )}
      {/* Apuntar la orden a un pedido de BC. Dos agujeros, el mismo botón:
          · el pedido se borró allá y crearon otro (Proveeduría "corrige" así), y la
            orden se quedó hablando con un número muerto;
          · la orden vive en BC pero la app nunca se enteró del número — es el caso
            que "Volver a abrir" ya avisaba ("buscá el pedido en BC a mano") sin dar
            después ningún lugar donde anotarlo.
          En los dos casos, hasta ahora, la orden quedaba trabada sin salida. */}
      {(orden.bcNumber || orden.estado === "lanzado" || orden.estado === "pendiente_aprobacion") && (
        <Button variant="outline" disabled={procesando}
          title={orden.bcNumber
            ? `Esta orden recibe y factura contra el pedido ${orden.bcNumber} de Business Central. Si en BC lo borraron y crearon otro, apuntala al nuevo.`
            : "Esta orden no tiene N.º de Business Central guardado: buscá el pedido en BC y anotalo acá para que Bodega pueda registrar contra él."}
          onClick={() => { setNuevoBc(""); setMotivoBc(""); setRenumerando(true); }}>
          {orden.bcNumber ? "Corregir N.º de BC" : "Poner el N.º de BC"}
        </Button>
      )}
    </>
  );

  return (
    <>
      <OrdenDetalle orden={orden} volverHref="/proveeduria/ordenes" volverLabel="Volver a órdenes" acciones={acciones} solicitudHref={solicitudHref}
        onAlinearIva={() => usarIvaDeBc()}
        pedidoHref={(n) => { const p = pedidos.find((x) => x.numero === n); return p ? `/proveeduria/solicitudes/${p.id}` : null; }}
        aviso={espera ? (
          <div className="ds-callout ds-callout--yellow mb-4" role="status">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div style={{ flex: 1 }}>
              <div className="ds-callout__title">Esperando la corrección del ingeniero</div>
              <div className="ds-callout__body">
                Todo el material volvió al ingeniero, pero la orden NO se descartó: conserva su N.º <span className="ds-strong">{orden.bcNumber}</span>.
                Cuando el ingeniero devuelva el material corregido, agregalo desde <span className="ds-strong">Editar → “+ De solicitudes”</span> y volvé a
                enviarla a aprobación: al reenviarla, ese mismo pedido de Business Central se limpia y le caen las líneas
                nuevas (no se crea otro pedido). Mientras esperás, allá siguen las viejas: no lo recibas ni lo lances.
              </div>
            </div>
          </div>
        ) : avisoBc ? (
          <div className="ds-callout ds-callout--yellow mb-4" role="alert">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div style={{ flex: 1 }}>
              <div className="ds-callout__title">Business Central quedó desalineado</div>
              <div className="ds-callout__body" style={{ whiteSpace: "pre-wrap" }}>{avisoBc}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAvisoBc(null)}>Entendido</Button>
          </div>
        ) : null} />

      {renumerando && (
        <Modal title={`${orden.bcNumber ? "Corregir" : "Poner"} el N.º de Business Central de ${numeroOrden(orden)}`} onClose={() => setRenumerando(false)} footer={
          <>
            <Button variant="outline" onClick={() => setRenumerando(false)} disabled={procesando}>Cancelar</Button>
            <Button onClick={() => void confirmarRenumerado()} disabled={procesando || !nuevoBc.trim()}>
              {procesando ? "Verificando en BC…" : "Apuntar a este pedido"}
            </Button>
          </>
        }>
          <p className="ds-body-sm" style={{ marginTop: 0 }}>
            {orden.bcNumber ? (<>
              Esta orden recibe y factura contra el pedido <span className="ds-strong">{orden.bcNumber}</span>.
              Si en Business Central lo <span className="ds-strong">borraron y crearon otro</span> (es lo que pasa cuando
              hay que corregirle el almacén o las líneas), apuntala acá al número nuevo: Bodega vuelve a poder registrar
              normal y BC hace la recepción y la factura de verdad.
            </>) : (<>
              Esta orden <span className="ds-strong">no tiene N.º de Business Central guardado</span>, así que Bodega no
              puede registrar contra ella y acá no se puede des-lanzar nada. Buscá el pedido en BC (por proveedor y fecha)
              y anotá su número.
            </>)}
          </p>
          <Field label="N.º del pedido en Business Central" help="Se verifica contra BC antes de guardarlo: si ese pedido no existe allá, no se guarda.">
            <Input value={nuevoBc} placeholder="CP-005300" autoFocus spellCheck={false}
              onChange={(e) => setNuevoBc(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Motivo (opcional)" help="Queda en la bitácora junto con el número viejo. Dentro de tres meses es la única explicación de por qué las fechas no calzan.">
            <Textarea rows={2} value={motivoBc} maxLength={200}
              onChange={(e) => setMotivoBc(e.target.value)} placeholder="Ej. Proveeduría borró el pedido para ponerle el almacén y creó este" />
          </Field>
          {tieneRecepciones && (
            <p className="ds-body-sm ds-pending-text">
              OJO: esta orden ya tiene recepciones registradas. Lo que ya se recibió sigue apuntando al documento
              con el que se registró en su momento; el número nuevo manda solo de acá en adelante.
            </p>
          )}
        </Modal>
      )}

      {descartando && (
        <Modal title={`Descartar ${numeroOrden(orden)}`} onClose={() => setDescartando(false)} footer={
          <>
            <Button variant="outline" onClick={() => setDescartando(false)} disabled={procesando}>Cancelar</Button>
            <Button variant="red" onClick={() => void confirmarDescarte()} disabled={procesando}>
              {procesando ? "Descartando…" : "Descartar borrador"}
            </Button>
          </>
        }>
          <p className="ds-body-sm" style={{ marginTop: 0 }}>
            Esta orden se arma sobre material de una solicitud, y mientras exista ese material figura como
            <span className="ds-strong"> ya ordenado</span>. Al descartarla vuelve a quedar
            <span className="ds-strong"> pendiente en la solicitud</span>: se puede volver a ordenar (a otro proveedor, por ejemplo)
            o devolvérselo al ingeniero.
          </p>
          <p className="ds-body-sm ds-muted">
            La orden desaparece del listado y queda el registro en el historial. No existe en Business Central, así que allá no hay nada que deshacer.
          </p>
          <Field label="Motivo (opcional)" help="Queda en el historial: dentro de un mes explica por qué se descartó.">
            <Textarea rows={2} value={motivoDescarte} maxLength={200}
              onChange={(e) => setMotivoDescarte(e.target.value)} placeholder="Ej. se armó con el proveedor equivocado" />
          </Field>
        </Modal>
      )}

      {devolviendo && (
        <Modal wide title={`Devolver material de ${numeroOrden(orden)} al ingeniero`} onClose={() => setDevolviendo(false)} footer={
          <>
            <Button variant="outline" onClick={() => setDevolviendo(false)} disabled={procesando}>Cancelar</Button>
            <Button variant="red" onClick={() => void confirmarDevolucion()} disabled={procesando || !elegidasDev.length || !motivoDev.trim()}>
              {procesando ? "Devolviendo…" : `Devolver ${elegidasDev.length} línea(s)`}
            </Button>
          </>
        }>
          <p className="ds-body-sm" style={{ marginTop: 0 }}>
            El material que elijas <span className="ds-strong">sale de esta orden</span> y vuelve a quedar pendiente en su
            solicitud, marcado como devuelto: el ingeniero lo ve en su bandeja de devoluciones con el motivo y lo corrige
            desde Producción. Cuando vuelva corregido, aparece acá en <span className="ds-strong">Devoluciones → Listas para ordenar</span>.
          </p>
          {orden.bcNumber && (
            <p className="ds-body-sm ds-pending-text">
              Esta orden ya existe en Business Central como {orden.bcNumber}: {dejaSinMaterial
                ? "al quedar sin material se descarta acá, pero el pedido de BC hay que darlo de baja allá (se avisa con el link)."
                : "las líneas que queden se le vuelven a empujar a BC."}
            </p>
          )}
          <div className="ds-table-wrap mt-2" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th style={{ width: 40 }}></th><th>Material</th><th className="ds-num">Cantidad</th><th>Solicitud</th><th>Estado</th></tr></thead>
              <tbody>
                {orden.lineas.map((l) => {
                  const bloqueo = motivoNoDevolverLineaOrden(l);
                  return (
                    <tr key={l.id} style={bloqueo ? { opacity: 0.55 } : undefined}>
                      <td>
                        <Checkbox checked={!!selDev[l.id]} disabled={!!bloqueo}
                          aria-label={`Devolver ${l.descripcion}`}
                          onChange={(e) => setSelDev((m) => ({ ...m, [l.id]: e.target.checked }))} />
                      </td>
                      <td>
                        <div className="ds-clamp-2" style={{ maxWidth: 360 }}>{l.descripcion}</div>
                        <div className="ds-body-sm ds-muted">{l.articuloId}{l.variantCode ? ` · var. ${l.variantCode}` : ""}</div>
                      </td>
                      <td className="ds-num ds-body-sm">{num.format(l.cantidad)} {l.unidad}</td>
                      <td className="ds-body-sm ds-muted">{l.pedidoNumero ?? "—"}</td>
                      <td className="ds-body-sm ds-muted">{bloqueo || "se puede devolver"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dejaSinMaterial && (
            <p className="ds-body-sm ds-pending-text mt-2">
              Vuelve TODO el material: esta orden se queda sin líneas y se descarta.
            </p>
          )}
          <Field label="Qué tiene que corregir" help="Lo lee el ingeniero en su bandeja de devoluciones. Sé concreto: es lo único que le dice qué hacer." className="mt-4">
            <Textarea rows={2} value={motivoDev} maxLength={200}
              onChange={(e) => setMotivoDev(e.target.value)}
              placeholder="Ej. falta la variante del tapón sanitario: decinos si va cementar o roscar" />
          </Field>
        </Modal>
      )}

      {cerrando && (
        <Modal title={`Cerrar ${numeroOrden(orden)}`} onClose={() => setCerrando(false)} footer={
          <>
            <Button variant="outline" onClick={() => setCerrando(false)} disabled={procesando}>Cancelar</Button>
            <Button onClick={() => void confirmarCierre()} disabled={procesando || !motivo}>
              {procesando ? "Cerrando…" : crearNueva ? "Cerrar y crear la nueva" : "Cerrar orden"}
            </Button>
          </>
        }>
          <div className="col gap-4">
            <p className="ds-body-sm">
              {pendiente.unidades > 0
                ? <>Quedan <span className="ds-strong">{num.format(pendiente.unidades)} unidad(es)</span> sin recibir en {pendiente.lineas} línea(s). La orden pasa a <span className="ds-strong">Completada</span> y sale de “por recibir”.</>
                : <>Esta orden ya se recibió completa. Pasa a <span className="ds-strong">Completada</span>.</>}
            </p>
            <Field label="Motivo del cierre">
              <Select value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Elegí un motivo…">
                {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Nota (opcional)">
              <Textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Detalle para el historial" />
            </Field>
            {pendiente.unidades > 0 && (
              <div className="col gap-2">
                <Checkbox checked={crearNueva}
                  onChange={(e) => { setCrearNueva(e.target.checked); if (e.target.checked) setDevolver(true); }}
                  label="Crear una orden nueva con lo pendiente (para comprárselo a otro proveedor)" />
                <Checkbox checked={devolver} disabled={crearNueva}
                  onChange={(e) => setDevolver(e.target.checked)}
                  label="Devolver lo pendiente a las solicitudes, para poder volver a comprarlo" />
                {/* Sin devolver el saldo, esas unidades quedan "ya ordenadas" y nadie
                    las puede volver a pedir sin abrir una solicitud nueva. */}
                {!devolver && <span className="ds-body-sm ds-muted">Ojo: si no las devolvés, esas unidades quedan consumidas y no van a aparecer para comprar de nuevo.</span>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
