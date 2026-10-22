import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi } from '../api/cliente';
import { cop } from '../api/formato';
import { Boton } from '../componentes/ui';
import { FormularioEntrega } from './FormularioEntrega';
import type { AccionEntrada, BotonAccion, MensajeUI, ProductoChat, RespuestaApi } from './tipos';

const CLAVE_CONV = 'drj_conversacion';
const leerConv = () => {
  try {
    return localStorage.getItem(CLAVE_CONV);
  } catch {
    return null;
  }
};
const guardarConv = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CLAVE_CONV, id);
    else localStorage.removeItem(CLAVE_CONV);
  } catch {
    /* almacenamiento no disponible: la conversación no se recordará */
  }
};

interface MensajeApi {
  id: number;
  rol: MensajeUI['rol'];
  contenido: string;
  metadata: { tipo?: string; datos?: unknown; acciones?: BotonAccion[] };
}

const desdeApi = (m: MensajeApi): MensajeUI => ({
  id: m.id,
  rol: m.rol,
  texto: m.contenido,
  tipo: m.metadata?.tipo ?? 'texto',
  datos: m.metadata?.datos,
  acciones: m.metadata?.acciones ?? [],
});

export default function PaginaChat() {
  const [convId, setConvId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [estado, setEstado] = useState<'activa' | 'escalada' | 'cerrada'>('activa');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horario, setHorario] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const local = useRef(0);

  const iniciar = useCallback(async () => {
    setError(null);
    const r = await api<{ conversacion_id: string; estado: typeof estado; respuestas: RespuestaApi[] }>('/chat/conversaciones', { metodo: 'POST' });
    guardarConv(r.conversacion_id);
    setConvId(r.conversacion_id);
    setEstado(r.estado);
    setMensajes(r.respuestas.map((x) => ({ id: x.mensaje_id, rol: 'asistente', texto: x.texto, tipo: x.tipo, datos: x.datos, acciones: x.acciones ?? [] })));
  }, []);

  // Al abrir: retomar la conversación guardada o crear una nueva
  useEffect(() => {
    const guardada = leerConv();
    (async () => {
      try {
        if (guardada) {
          const r = await api<{ estado: typeof estado; mensajes: MensajeApi[] }>(`/chat/conversaciones/${guardada}/mensajes`);
          if (r.estado !== 'cerrada') {
            setConvId(guardada);
            setEstado(r.estado);
            setMensajes(r.mensajes.map(desdeApi));
            return;
          }
        }
        await iniciar();
      } catch (e) {
        if (e instanceof ErrorApi && e.status === 404) return iniciar().catch(() => setError('No pudimos iniciar el chat. Intenta recargar la página.'));
        setError(e instanceof ErrorApi ? e.message : 'No pudimos iniciar el chat.');
      }
    })();
    api<Record<string, { valor: unknown; confirmado: boolean }>>('/negocio')
      .then((n) => setHorario(n.horario?.confirmado ? String(n.horario.valor) : null))
      .catch(() => undefined);
  }, [iniciar]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes]);

  // Cuando un asesor atiende, se consultan mensajes nuevos cada 5 segundos
  useEffect(() => {
    if (!convId || estado !== 'escalada') return;
    const t = setInterval(async () => {
      const ultimo = Math.max(0, ...mensajes.map((m) => (typeof m.id === 'number' ? m.id : 0)));
      try {
        const r = await api<{ estado: typeof estado; mensajes: MensajeApi[] }>(`/chat/conversaciones/${convId}/mensajes?despues=${ultimo}`);
        setEstado(r.estado);
        const nuevos = r.mensajes.filter((m) => m.rol !== 'cliente').map(desdeApi);
        if (nuevos.length) setMensajes((prev) => [...prev, ...nuevos.filter((n) => !prev.some((p) => p.id === n.id))]);
      } catch {
        /* reintenta en el siguiente ciclo */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [convId, estado, mensajes]);

  async function enviar(cuerpo: { texto?: string; accion?: AccionEntrada; etiqueta_accion?: string }, mostrar: string) {
    if (!convId || enviando) return;
    setEnviando(true);
    setError(null);
    local.current -= 1;
    setMensajes((m) => [...m, { id: `local${local.current}`, rol: 'cliente', texto: mostrar, tipo: 'texto', acciones: [] }]);
    try {
      const r = await api<{ estado: typeof estado; asesor_atendiendo: boolean; respuestas: RespuestaApi[] }>(`/chat/conversaciones/${convId}/mensajes`, {
        metodo: 'POST',
        cuerpo,
      });
      setEstado(r.estado);
      setMensajes((m) => [...m, ...r.respuestas.map((x) => ({ id: x.mensaje_id, rol: 'asistente' as const, texto: x.texto, tipo: x.tipo, datos: x.datos, acciones: x.acciones ?? [] }))]);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo enviar el mensaje.');
    } finally {
      setEnviando(false);
    }
  }

  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    void enviar({ texto: t }, t);
  };
  const alAccion = (b: BotonAccion) => void enviar({ accion: b.accion, etiqueta_accion: b.etiqueta }, b.etiqueta);

  const nueva = async () => {
    guardarConv(null);
    setMensajes([]);
    await iniciar().catch(() => setError('No pudimos iniciar el chat.'));
  };

  const ultimoBot = [...mensajes].reverse().find((m) => m.rol !== 'cliente')?.id;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-marca-800 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl">
              🏍️
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight">Don Repuestos Jaimes</h1>
              <p className="text-xs text-blue-100">
                Repuestos Yamaha<span className="hidden sm:inline"> · {horario ?? 'Horario por confirmar'}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={nueva} className="rounded-lg px-2 py-1 text-xs text-blue-100 hover:bg-white/10">
              Nueva<span className="hidden sm:inline"> conversación</span>
            </button>
            <Link to="/admin" className="rounded-lg px-2 py-1 text-xs text-blue-100 hover:bg-white/10">
              Panel
            </Link>
          </div>
        </div>
      </header>

      {estado === 'escalada' && (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-center text-sm text-violet-900">Tu conversación fue enviada a un asesor. Sus respuestas aparecerán aquí.</div>
      )}

      <main className="flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4">
          {mensajes.map((m) => (
            <Burbuja key={m.id} m={m} activo={m.id === ultimoBot && !enviando} onAccion={alAccion} />
          ))}
          {enviando && <p className="text-sm text-slate-500">Don Repuestos está escribiendo…</p>}
          <div ref={finRef} />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <form onSubmit={alEnviar} className="mx-auto flex max-w-3xl gap-2 px-4 py-3">
          <label htmlFor="mensaje" className="sr-only">
            Escribe tu mensaje
          </label>
          <input
            id="mensaje"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={1000}
            autoComplete="off"
            placeholder="Ej.: pastillas delanteras para FZ 2.0 2018"
            className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm focus:border-marca-600 focus:outline-none focus:ring-2 focus:ring-marca-100"
          />
          <Boton type="submit" disabled={!texto.trim() || enviando || !convId} className="rounded-full">
            Enviar
          </Boton>
        </form>
        {error && <p className="mx-auto max-w-3xl px-4 pb-2 text-sm text-red-700">{error}</p>}
        <p className="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-slate-500">🔒 Nunca compartas claves ni números de tarjeta por este chat.</p>
      </footer>
    </div>
  );
}

function Burbuja({ m, activo, onAccion }: { m: MensajeUI; activo: boolean; onAccion: (b: BotonAccion) => void }) {
  if (m.rol === 'cliente') {
    return <div className="ml-auto max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-sm bg-marca-700 px-4 py-2 text-sm text-white">{m.texto}</div>;
  }
  const estilo =
    m.tipo === 'error'
      ? 'border-red-200 bg-red-50 text-red-900'
      : m.tipo === 'pedido_registrado'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : m.tipo === 'escalado' || m.rol === 'asesor'
          ? 'border-violet-200 bg-violet-50 text-violet-900'
          : 'border-slate-200 bg-white text-slate-900';

  return (
    <div className="mr-auto flex max-w-[92%] flex-col gap-2">
      {m.rol === 'asesor' && <span className="text-xs font-medium text-violet-800">Asesor de Don Repuestos Jaimes</span>}
      {m.tipo === 'productos' && Array.isArray((m.datos as { productos?: unknown })?.productos) ? (
        <ProductosChat m={m} activo={activo} onAccion={onAccion} />
      ) : (
        <div className={`whitespace-pre-line rounded-2xl rounded-bl-sm border px-4 py-2 text-sm shadow-sm ${estilo}`}>{m.texto}</div>
      )}
      {m.tipo === 'formulario_entrega' && activo && (
        <FormularioEntrega valores={(m.datos as { valores?: Record<string, string> })?.valores ?? {}} onEnviar={(datos) => onAccion({ etiqueta: 'Enviar datos de entrega', accion: { tipo: 'datos_entrega', datos } })} />
      )}
      {activo && m.tipo !== 'productos' && m.acciones.length > 0 && <Acciones acciones={m.acciones} onAccion={onAccion} />}
    </div>
  );
}

function Acciones({ acciones, onAccion }: { acciones: BotonAccion[]; onAccion: (b: BotonAccion) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {acciones.map((a, i) => (
        <Boton key={i} variante={i === 0 ? 'primario' : 'secundario'} tamano="sm" onClick={() => onAccion(a)}>
          {a.etiqueta}
        </Boton>
      ))}
    </div>
  );
}

/** Muestra los productos como tarjetas, solo con los datos confirmados por el inventario. */
function ProductosChat({ m, activo, onAccion }: { m: MensajeUI; activo: boolean; onAccion: (b: BotonAccion) => void }) {
  const productos = (m.datos as { productos: ProductoChat[] }).productos;
  const bloques = m.texto.split('\n\n');
  const encabezado = bloques[0];
  const notas = bloques.slice(1 + productos.length);
  const otras = m.acciones.filter((a) => a.accion.tipo !== 'agregar');
  return (
    <div className="flex flex-col gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <p className="font-medium">{encabezado}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {productos.map((p, i) => {
          const d = p.disponibilidad;
          return (
            <li key={p.producto_id} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {productos.length > 1 && <span className="text-xs font-semibold text-slate-500">Opción {i + 1}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.tipo === 'original' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                  {p.tipo === 'original' ? 'Original Yamaha' : `Genérico · ${p.marca}`}
                </span>
                {p.es_demo && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Demo ficticio</span>}
              </div>
              <p className="font-semibold">{p.nombre}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs text-slate-700">
                <dt className="text-slate-500">Referencia</dt>
                <dd className="font-mono">{p.referencia}</dd>
                <dt className="text-slate-500">Compatibilidad</dt>
                <dd>{p.compatibilidad.verificada ? `${p.compatibilidad.modelo} ${p.compatibilidad.anio_desde}–${p.compatibilidad.anio_hasta}` : 'Sin verificar (la confirma un asesor)'}</dd>
                <dt className="text-slate-500">Disponibilidad</dt>
                <dd className={d.estado === 'agotado' ? 'font-medium text-red-700' : ''}>
                  {d.estado === 'agotado'
                    ? `Agotado${d.tiempo_abastecimiento_dias ? ` · llega en ~${d.tiempo_abastecimiento_dias} días` : ''}`
                    : d.cantidad === null
                      ? 'Por confirmar'
                      : `${d.cantidad} ${d.cantidad === 1 ? 'unidad' : 'unidades'}`}
                </dd>
              </dl>
              <p className="text-lg font-semibold tabular-nums">{p.precio ? cop(p.precio) : <span className="text-sm font-normal text-slate-600">Precio por confirmar con un asesor</span>}</p>
              {activo && p.vendible && (
                <Boton tamano="sm" onClick={() => onAccion({ etiqueta: `Agregar ${p.nombre} (${p.referencia})`, accion: { tipo: 'agregar', producto_id: p.producto_id, cantidad: 1 } })}>
                  Agregar al pedido
                </Boton>
              )}
            </li>
          );
        })}
      </ul>
      {notas.map((n, i) => (
        <p key={i} className={n.startsWith('⚠️') ? 'rounded-lg bg-amber-50 px-2 py-1 text-amber-900' : 'text-slate-700'}>
          {n}
        </p>
      ))}
      {activo && otras.length > 0 && <Acciones acciones={otras} onAccion={onAccion} />}
    </div>
  );
}
