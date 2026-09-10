"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Modal } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { lineasPorMaquina, pendientePorAsignar, repartirEnPartesIguales, totalAsignado, type LineaDeMaquina } from "@/lib/maquinas";
import { useStore } from "@/lib/store";

// LA MÁQUINA DE UNA LÍNEA, EN UN SOLO LUGAR.
//
// En Business Central el equipo que se come el repuesto viaja en la LÍNEA del pedido
// de compra ("N.º máquina", del parque de maquinaria GomEqp), no en el encabezado. La
// eligen DOS pantallas —compra directa y la corrección de una orden Abierta— y las
// dos necesitan exactamente lo mismo: el catálogo de BC (que tarda), el buscador con
// "Sin máquina" y el diálogo que parte una línea en una por máquina. Acá está una
// sola vez para que no haya dos copias que se separen: si el parque cambia de
// endpoint o el rótulo cambia de texto, se arregla en un archivo.
//
// La matemática del reparto NO vive acá: es de lib/maquinas.ts, que se prueba sin
// React ni BC (lib/maquinas.test.ts).

export type MaquinaCat = { no: string; nombre: string; placa?: string };

// Referencia estable: `[]` nuevo en cada render haría que los useMemo de quien la
// consume se recalcularan para siempre.
const SIN_MAQUINAS: MaquinaCat[] = [];

// EL PARQUE DE MAQUINARIA DE BC, con su espera.
//
// Se pide aparte de los demás catálogos porque puede tardar: hoy sale del web service
// OData de la página de máquinas y la primera lectura del día son ~75 s (después queda
// cacheada horas en el servidor). El endpoint contesta `cargando: true` mientras está
// en eso, así que se vuelve a preguntar en vez de dejar el selector vacío como si no
// hubiera máquinas.
//
// En modo mock cae al catálogo de trabajo del store; en modo API no se inventa
// ninguno: si BC no lo dio, la lista queda vacía y la pantalla lo dice, que es la
// verdad (falta publicar la página, no falta maquinaria).
export function useMaquinasBc(): { maquinas: MaquinaCat[]; cargando: boolean } {
  const { maquinas: mock, modoApi } = useStore();
  const [bcMaq, setBcMaq] = useState<MaquinaCat[] | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    let intentos = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pedir = () => {
      fetch("/api/bc/maquinas").then((r) => (r.ok ? r.json() : { maquinas: [] }))
        .then((d) => {
          if (!vivo) return;
          if (Array.isArray(d.maquinas) && d.maquinas.length) { setBcMaq(d.maquinas); setCargando(false); return; }
          // Sigue leyéndolo en el servidor: se pregunta de nuevo (hasta ~2 min).
          if (d.cargando && intentos++ < 15) { timer = setTimeout(pedir, 8000); return; }
          setBcMaq([]); setCargando(false);
        })
        .catch(() => { if (vivo) { setBcMaq([]); setCargando(false); } });
    };
    pedir();
    return () => { vivo = false; if (timer) clearTimeout(timer); };
  }, []);
  const maquinas = useMemo<MaquinaCat[]>(
    () => (bcMaq?.length ? bcMaq : modoApi ? SIN_MAQUINAS : mock),
    [bcMaq, modoApi, mock],
  );
  return { maquinas, cargando };
}

// Sin nombre —o con el nombre igual al código, que en BC pasa— se muestra solo el
// N.º: "GENERICO — GENERICO" no informa nada.
export function etiquetaMaquina(m: MaquinaCat): string {
  if (!m.no) return m.nombre;
  const nom = (m.nombre ?? "").trim();
  return `${m.no}${nom && nom !== m.no ? ` — ${nom}` : ""}${m.placa ? ` · ${m.placa}` : ""}`;
}
export const buscarMaquina = (m: MaquinaCat) => `${m.no} ${m.nombre} ${m.placa ?? ""}`;
export const nombreDeMaquina = (maquinas: MaquinaCat[], no: string) =>
  maquinas.find((m) => m.no === (no ?? "").trim())?.nombre ?? "";

const placeholderMaquina = (maquinas: MaquinaCat[], cargando: boolean) =>
  maquinas.length ? "Sin máquina…" : cargando ? "Buscando el parque en BC…" : "Parque de maquinaria no disponible";

// Campo "Máquina" para el diálogo de destino de una línea. Devuelve el N.º y el
// nombre: el N.º es lo único que viaja a BC y al SQL, el nombre es para que la celda
// no muestre un código pelado.
export function CampoMaquina({
  maquinas, cargando, value, nombre = "", onChange, label = "Máquina", help, className = "",
}: {
  maquinas: MaquinaCat[];
  cargando: boolean;
  value: string;
  nombre?: string;
  onChange: (no: string, nombre: string) => void;
  label?: string;
  help?: string;
  className?: string;
}) {
  // El Combobox no se puede vaciar solo: "Sin máquina" es una opción más (N.º "").
  // Sin ella, elegir una máquina por error no se podría deshacer.
  const conVacio = useMemo<MaquinaCat[]>(() => [{ no: "", nombre: "Sin máquina" }, ...maquinas], [maquinas]);
  const puesta = (value ?? "").trim();
  // La línea trae una máquina que el parque de BC no tiene: el Combobox no la
  // encuentra y el campo sale VACÍO, o sea que parece que la línea no tiene máquina y
  // guardar se la borraría. Se dice, igual que con la obra que no existe. Mientras el
  // parque no haya llegado no se avisa nada: no se sabe.
  const desconocida = !!puesta && !cargando && maquinas.length > 0 && !maquinas.some((m) => m.no === puesta);
  return (
    <>
      <Field label={label} className={className}
        help={help ?? "Opcional. El equipo al que va el repuesto (N.º máquina de la línea en BC)."}>
        <Combobox items={conVacio} value={puesta}
          onChange={(k) => onChange(k, nombreDeMaquina(maquinas, k))}
          getKey={(m) => m.no} getLabel={etiquetaMaquina} getSearch={buscarMaquina}
          placeholder={placeholderMaquina(maquinas, cargando)} />
      </Field>
      {desconocida && (
        <p className="ds-body-sm" style={{ color: "var(--ds-color-red-200)", margin: "8px 0 0" }}>
          La línea trae <span className="ds-strong">{puesta}{nombre && nombre !== puesta ? ` — ${nombre}` : ""}</span>, que no
          está en el parque de maquinaria de Business Central (por eso el campo de arriba sale vacío). Elegí la máquina
          real o dejala sin máquina: BC rechaza la línea si el N.º de máquina no existe.
        </p>
      )}
    </>
  );
}

// Una máquina del reparto: cuántas unidades de la línea van a ESE equipo. `cantidad`
// es texto porque es lo que hay en el campo mientras se escribe.
interface AsigMaq { key: string; no: string; nombre: string; cantidad: string; }
const uid = () => Math.random().toString(36).slice(2, 9);

// REPARTIR UNA LÍNEA ENTRE VARIAS MÁQUINAS. El caso real: tres filtros de motor, uno
// para cada vagoneta. En BC el N.º máquina va en la LÍNEA, así que la única forma de
// que cada equipo quede con su costo es que cada uno tenga su línea — y eso es lo que
// devuelve `onGuardar`: las líneas en las que queda partida la original (la última sin
// máquina si sobró cantidad).
export function RepartoMaquinasModal({
  codigo, descripcion, total, unidad, maquinaInicial = "", maquinaNombreInicial = "",
  maquinas, cargando, onClose, onGuardar,
}: {
  codigo: string;
  descripcion: string;
  total: number;
  unidad: string;
  maquinaInicial?: string;
  maquinaNombreInicial?: string;
  maquinas: MaquinaCat[];
  cargando: boolean;
  onClose: () => void;
  onGuardar: (lineas: LineaDeMaquina[]) => void;
}) {
  // Si la línea ya tenía una máquina, arranca con ella y toda la cantidad: lo normal
  // es venir a partirla, no a empezar de cero.
  const [asignaciones, setAsignaciones] = useState<AsigMaq[]>(() =>
    maquinaInicial ? [{ key: uid(), no: maquinaInicial, nombre: maquinaNombreInicial, cantidad: String(total) }] : []);

  // Reparte la cantidad parejo entre las máquinas que haya. Se llama al agregar o
  // quitar una —así 1 máquina se lleva las 3 y 3 máquinas se llevan 1 cada una, sin
  // que nadie escriba números— y también a mano con el botón.
  const parejo = (asigs: AsigMaq[]): AsigMaq[] => {
    const partes = repartirEnPartesIguales(total, asigs.length);
    return asigs.map((a, i) => ({ ...a, cantidad: String(partes[i] ?? 0) }));
  };
  const agregar = (no: string) => {
    if (!no) return;
    // La misma máquina dos veces serían dos líneas del mismo equipo: no se agrega de
    // nuevo, se deja la que ya está (su cantidad se corrige a mano).
    if (asignaciones.some((a) => a.no === no)) return;
    setAsignaciones((as) => parejo([...as, { key: uid(), no, nombre: nombreDeMaquina(maquinas, no), cantidad: "0" }]));
  };
  const quitar = (key: string) => setAsignaciones((as) => parejo(as.filter((a) => a.key !== key)));
  const setCantidad = (key: string, cantidad: string) =>
    setAsignaciones((as) => as.map((a) => (a.key === key ? { ...a, cantidad } : a)));

  const asigNum = asignaciones.map((a) => ({ no: a.no, nombre: a.nombre, cantidad: Number(a.cantidad) || 0 }));
  const asignado = totalAsignado(asigNum);
  const falta = pendientePorAsignar(total, asigNum);
  const conMaquina = asignaciones.filter((a) => Number(a.cantidad) > 0).length;
  const lineasQueQuedan = lineasPorMaquina(total, asigNum).length;
  // Las que ya están puestas no se ofrecen otra vez: dos filas del mismo equipo
  // serían dos líneas del mismo equipo.
  const disponibles = maquinas.filter((m) => !asignaciones.some((a) => a.no === m.no));

  return (
    <Modal title="Repartir entre máquinas" onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={falta < 0} onClick={() => onGuardar(lineasPorMaquina(total, asigNum))}>
            {lineasQueQuedan > 1 ? `Partir en ${lineasQueQuedan} líneas` : "Guardar"}
          </Button>
        </>
      }>
      <p className="ds-body-sm ds-muted" style={{ marginBottom: 6 }}>{[codigo, descripcion].filter(Boolean).join(" — ")}</p>
      <p className="ds-body-sm" style={{ marginBottom: 16 }}>
        La línea trae <span className="ds-strong">{total} {unidad || "UND"}</span>. En Business Central el
        N.º de máquina va en la línea, así que <span className="ds-strong">cada máquina se lleva su propia línea</span> y
        el costo del repuesto cae en el equipo correcto.
      </p>
      <Field label="Agregar máquina"
        help="Al agregar o quitar una máquina, la cantidad se reparte parejo entre las que queden; después la ajustás a mano.">
        <Combobox items={disponibles} value="" onChange={(k) => agregar(k)}
          getKey={(m) => m.no} getLabel={etiquetaMaquina} getSearch={buscarMaquina}
          placeholder={maquinas.length ? "Buscar máquina…" : cargando ? "Buscando el parque en BC…" : "Parque de maquinaria no disponible"} />
      </Field>

      {asignaciones.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          Todavía no hay máquinas. Elegí la primera arriba: la línea se va a partir en una por cada una.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {asignaciones.map((a) => (
            <div key={a.key} className="maq-fila">
              <div>
                <div className="maq-fila__no">{a.no}</div>
                {a.nombre && a.nombre !== a.no && <div className="maq-fila__nombre">{a.nombre}</div>}
              </div>
              <span className="row gap-2" style={{ alignItems: "baseline", justifyContent: "flex-end" }}>
                <input className="ds-cell-input" aria-label={`Cantidad para ${a.no}`} type="number" min={0}
                  value={a.cantidad} style={{ width: 60 }} onChange={(e) => setCantidad(a.key, e.target.value)} />
                <span className="ds-body-sm ds-muted">{unidad || "UND"}</span>
              </span>
              <button type="button" className="icon-btn icon-btn--quitar" title={`Quitar ${a.no}`}
                aria-label={`Quitar ${a.no}`} onClick={() => quitar(a.key)}>×</button>
            </div>
          ))}
          <div className={`maq-cuenta${falta < 0 ? " maq-cuenta--pasado" : ""}`} role="status">
            <span className="ds-body-sm">
              Repartido <span className="ds-strong">{asignado}</span> de {total} {unidad || "UND"}
              {falta > 0 && <> · quedan <span className="ds-strong">{falta}</span> en una línea aparte, sin máquina</>}
              {falta < 0 && <> · te pasaste por <span className="ds-strong">{Math.abs(falta)}</span>: la orden pediría más de lo que querés</>}
            </span>
            {asignaciones.length > 1 && (
              <button type="button" className="link-btn ds-body-sm"
                onClick={() => setAsignaciones(parejo(asignaciones))}>Repartir en partes iguales</button>
            )}
          </div>
          {conMaquina > 1 && (
            <p className="ds-body-sm ds-muted" style={{ marginTop: 12 }}>
              Al guardar, esta línea se convierte en <span className="ds-strong">{lineasQueQuedan} líneas</span> del
              mismo material{falta > 0 ? " (la última sin máquina)" : ""}. El precio, el descuento y el IVA se copian
              en todas.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
