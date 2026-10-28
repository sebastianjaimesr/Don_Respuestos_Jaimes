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

// Si el servidor no responde (por ejemplo, porque estaba en pausa), se reintenta durante este tiempo.
const REINTENTAR_DURANTE_MS = 3 * 60_000;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reintentable = (e: unknown) => !(e instanceof ErrorApi) || e.status === 0 || e.status >= 500;

export default function PaginaChat() {
  const [convId, setConvId] = useState<string | null>(null);
  const [conexion, setConexion] = useState<'conectando' | 'lista' | 'fallida'>('conectando');
  const [segundos, setSegundos] = useState(0);
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [estado, setEstado] = useState<'activa' | 'escalada' | 'cerrada'>('activa');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horario, setHorario] = useState<string | null>(null);
  // Mensaje escrito antes de conectar: se envía apenas haya conversación
  const pendiente = useRef<string | null>(null);
  const [hayPendiente, setHayPendiente] = useState(false);
  const conectando = useRef(false);
  const finRef = useRef<HTMLDivElement>(null);
  const local = useRef(0);

  const iniciar = useCallback(async () => {
    const r = await api<{ conversacion_id: string; estado: typeof estado; respuestas: RespuestaApi[] }>('/chat/conversaciones', { metodo: 'POST' });
    guardarConv(r.conversacion_id);
    setConvId(r.conversacion_id);
    setEstado(r.estado);
    setMensajes((prev) => [
      ...r.respuestas.map((x) => ({ id: x.mensaje_id, rol: 'asistente' as const, texto: x.texto, tipo: x.tipo, datos: x.datos, acciones: x.acciones ?? [] })),
      ...prev.filter((m) => m.rol === 'cliente'),
    ]);
  }, []);

  // Retoma la conversación guardada o crea una nueva
  const abrir = useCallback(async () => {
    const guardada = leerConv();
    if (guardada) {
      try {
        const r = await api<{ estado: typeof estado; mensajes: MensajeApi[] }>(`/chat/conversaciones/${guardada}/mensajes`);
        if (r.estado !== 'cerrada') {
          setConvId(guardada);
          setEstado(r.estado);
          setMensajes((prev) => [...r.mensajes.map(desdeApi), ...prev.filter((m) => m.rol === 'cliente')]);
          return;
        }
      } catch (e) {
        if (!(e instanceof ErrorApi && e.status === 404)) throw e;
      }
    }
    await iniciar();
  }, [iniciar]);

  const conectar = useCallback(async () => {
    if (conectando.current) return;
    conectando.current = true;
    setConexion('conectando');
    setError(null);
    const inicio = Date.now();
    try {
      for (let intento = 1; ; intento++) {
        try {
          await abrir();
          setConexion('lista');
          api<Record<string, { valor: unknown; confirmado: boolean }>>('/negocio')
            .then((n) => setHorario(n.horario?.confirmado ? String(n.horario.valor) : null))
            .catch(() => undefined);
          return;
        } catch (e) {
          if (!reintentable(e) || Date.now() - inicio > REINTENTAR_DURANTE_MS) {
            setConexion('fallida');
            setError(e instanceof ErrorApi ? e.message : 'No pudimos iniciar el chat.');
            return;
          }
          await esperar(Math.min(5000 * intento, 15000));
        }
      }
    } finally {
      conectando.current = false;
    }
  }, [abrir]);

  useEffect(() => {
    void conectar();
  }, [conectar]);

  // Contador visible mientras se conecta
  useEffect(() => {
    if (conexion !== 'conectando') return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [conexion]);

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

  async function enviar(cuerpo: { texto?: string; accion?: AccionEntrada; etiqueta_accion?: string }, mostrar: string, yaMostrado = false) {
    if (!convId || enviando) return;
    setEnviando(true);
    setError(null);
    if (!yaMostrado) {
      local.current -= 1;
      setMensajes((m) => [...m, { id: `local${local.current}`, rol: 'cliente', texto: mostrar, tipo: 'texto', acciones: [] }]);
    }
    try {
      const r = await api<{ estado: typeof estado; asesor_atendiendo: boolean; respuestas: RespuestaApi[] }>(`/chat/conversaciones/${convId}/mensajes`, {
        metodo: 'POST',
        cuerpo,
      });
      setEstado(r.estado);
      setMensajes((m) => [...m, ...r.respuestas.map((x) => ({ id: x.mensaje_id, rol: 'asistente' as const, texto: x.texto, tipo: x.tipo, datos: x.datos, acciones: x.acciones ?? [] }))]);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo enviar el mensaje.');
      // Se devuelve el texto al campo para que el cliente no tenga que escribirlo otra vez
      if (cuerpo.texto) setTexto((actual) => actual || cuerpo.texto!);
    } finally {
      setEnviando(false);
    }
  }

  // Apenas hay conversación, se envía lo que el cliente escribió mientras conectaba
  useEffect(() => {
    if (!convId || !pendiente.current) return;
    const t = pendiente.current;
    pendiente.current = null;
    setHayPendiente(false);
    void enviar({ texto: t }, t, true);
  }, [convId]);

  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    if (!convId) {
      pendiente.current = t;
      setHayPendiente(true);
      local.current -= 1;
      setMensajes((m) => [...m, { id: `local${local.current}`, rol: 'cliente', texto: t, tipo: 'texto', acciones: [] }]);
      if (conexion === 'fallida') void conectar();
      return;
    }
    void enviar({ texto: t }, t);
  };
  const alAccion = (b: BotonAccion) => void enviar({ accion: b.accion, etiqueta_accion: b.etiqueta }, b.etiqueta);

  const nueva = () => {
    guardarConv(null);
    setConvId(null);
    setMensajes([]);
    void conectar();
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
                Repuestos Yamaha
                {(horario || conexion === 'lista') && <span className="hidden sm:inline"> · {horario ?? 'Horario por confirmar'}</span>}
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
          {conexion !== 'lista' && <EstadoConexion conexion={conexion} segundos={segundos} hayPendiente={hayPendiente} error={error} onReintentar={() => void conectar()} />}
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
          <Boton type="submit" disabled={!texto.trim() || enviando || hayPendiente} className="rounded-full">
            Enviar
          </Boton>
        </form>
        {error && conexion === 'lista' && <p className="mx-auto max-w-3xl px-4 pb-2 text-sm text-red-700">{error}</p>}
        <p className="mx-auto max-w-3xl px-4 pb-3 text-center text-xs text-slate-500">🔒 Nunca compartas claves ni números de tarjeta por este chat.</p>
      </footer>
    </div>
  );
}

function EstadoConexion({ conexion, segundos, hayPendiente, error, onReintentar }: { conexion: 'conectando' | 'fallida'; segundos: number; hayPendiente: boolean; error: string | null; onReintentar: () => void }) {
  if (conexion === 'fallida') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <p>{error ?? 'No pudimos conectar con el asistente.'}</p>
        <Boton tamano="sm" onClick={onReintentar}>
          Reintentar
        </Boton>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
      <p className="flex items-center gap-2">
        <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-marca-600 border-t-transparent" />
        Conectando con el asistente… {segundos > 0 && <span className="tabular-nums text-slate-500">{segundos} s</span>}
      </p>
      {segundos >= 5 && <p className="text-slate-500">El servidor estaba en pausa por inactividad y se está despertando. Puede tardar hasta un minuto.</p>}
      <p className="text-slate-500">{hayPendiente ? 'Tu mensaje se enviará apenas conecte.' : 'Puedes ir escribiendo tu mensaje: lo enviamos apenas conecte.'}</p>
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
