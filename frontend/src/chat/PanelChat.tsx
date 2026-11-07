import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi } from '../api/cliente';
import { cop } from '../api/formato';
import { FormularioEntrega } from './FormularioEntrega';
import { BotonChat } from './BotonChat';
import { TarjetaPedido, esTarjetaPedido } from './TarjetaPedido';
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

/** Lo que la página de inicio puede pedirle al chat (por ejemplo, al tocar una categoría del catálogo). */
export interface ControlChat {
  /** Envía un texto como si el cliente lo hubiera escrito. */
  preguntar: (texto: string) => void;
  /** Lleva el foco al campo de texto. */
  enfocar: () => void;
}

/**
 * Asistente virtual de ventas. Toda la lógica (conexión con reintentos, pedidos,
 * datos de entrega, atención por asesor) es la misma de la versión anterior;
 * aquí solo cambia la presentación.
 */
export const PanelChat = forwardRef<ControlChat, { className?: string; pantallaCompleta?: boolean }>(function PanelChat({ className = '', pantallaCompleta = false }, ref) {
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
  const listaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
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

  // Desplaza solo la lista de mensajes (no la página completa)
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [mensajes, enviando]);

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

  /** Envía un texto del cliente; si aún no hay conversación, lo deja en cola. */
  function mandarTexto(t: string) {
    if (!convId) {
      if (pendiente.current) return; // ya hay un mensaje esperando la conexión
      pendiente.current = t;
      setHayPendiente(true);
      local.current -= 1;
      setMensajes((m) => [...m, { id: `local${local.current}`, rol: 'cliente', texto: t, tipo: 'texto', acciones: [] }]);
      if (conexion === 'fallida') void conectar();
      return;
    }
    void enviar({ texto: t }, t);
  }

  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    mandarTexto(t);
  };
  const alAccion = (b: BotonAccion) => void enviar({ accion: b.accion, etiqueta_accion: b.etiqueta }, b.etiqueta);

  useImperativeHandle(ref, () => ({
    preguntar: (t: string) => {
      const limpio = t.trim();
      if (limpio && !enviando) mandarTexto(limpio);
    },
    enfocar: () => campoRef.current?.focus({ preventScroll: true }),
  }));

  const nueva = () => {
    guardarConv(null);
    setConvId(null);
    setMensajes([]);
    void conectar();
  };

  const ultimoBotMsg = [...mensajes].reverse().find((m) => m.rol !== 'cliente');
  const ultimoBot = ultimoBotMsg?.id;
  const fase = faseConversacion({ conexion, estado, enviando, ultimo: ultimoBotMsg });

  return (
    <section
      aria-label="Asistente virtual de Don Repuestos Jaimes"
      className={`relative flex min-h-0 flex-col overflow-hidden text-slate-100 ${pantallaCompleta ? 'bg-noche-900' : 'vidrio rounded-[28px] shadow-[0_30px_80px_-20px_rgba(20,70,255,0.45)]'} ${className}`}
    >
      {/* brillo superior */}
      <div aria-hidden className="pointer-events-none absolute inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-electrico-400/70 to-transparent" />

      <header className="relative flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-electrico-400 to-electrico-600 shadow-[0_8px_24px_-6px_rgba(37,99,255,0.8)]"
          >
            <IconoAsistente className="h-6 w-6 text-white" />
            <span
              className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-noche-900 ${conexion === 'lista' ? 'bg-emerald-400' : conexion === 'fallida' ? 'bg-red-400' : 'animate-pulso-suave bg-amber-300'}`}
            />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-[15px] font-semibold leading-tight">Asistente Don Repuestos</h2>
            <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
              <EstadoFase fase={fase} />
              {(horario || conexion === 'lista') && <span className="hidden truncate sm:inline">· {horario ?? 'Horario por confirmar'}</span>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={nueva}
            title="Empezar una conversación nueva"
            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <IconoNuevo className="h-4 w-4" />
            Nueva<span className="hidden sm:inline"> conversación</span>
          </button>
          {pantallaCompleta && (
            <Link to="/" className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
              Inicio
            </Link>
          )}
        </div>
      </header>

      {estado === 'escalada' && (
        <div className="border-b border-violet-400/20 bg-violet-500/10 px-4 py-2 text-center text-xs text-violet-200 sm:text-sm">
          Tu conversación fue enviada a un asesor. Sus respuestas aparecerán aquí.
        </div>
      )}

      <div ref={listaRef} className="scroll-fino min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite">
        <div className={`mx-auto flex flex-col gap-3.5 px-3 py-5 sm:px-5 ${pantallaCompleta ? 'max-w-3xl' : ''}`}>
          {conexion !== 'lista' && <EstadoConexion conexion={conexion} segundos={segundos} hayPendiente={hayPendiente} error={error} onReintentar={() => void conectar()} />}
          {mensajes.map((m) => (
            <Burbuja key={m.id} m={m} activo={m.id === ultimoBot && !enviando} onAccion={alAccion} />
          ))}
          {enviando && <Escribiendo registrando={ultimoBotMsg?.tipo === 'resumen_pedido'} />}
        </div>
      </div>

      <footer className="border-t border-white/[0.07] bg-noche-950/40 px-3 pt-3 pb-2 sm:px-4">
        <form
          onSubmit={alEnviar}
          className={`mx-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 pl-4 transition focus-within:border-electrico-400/60 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_0_4px_rgba(37,99,255,0.15)] ${pantallaCompleta ? 'max-w-3xl' : ''}`}
        >
          <label htmlFor="mensaje" className="sr-only">
            Escribe tu mensaje
          </label>
          <input
            ref={campoRef}
            id="mensaje"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={1000}
            autoComplete="off"
            placeholder="Ej.: pastillas delanteras para FZ 2.0 2018"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!texto.trim() || enviando || hayPendiente}
            aria-label="Enviar mensaje"
            className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-electrico-400 to-electrico-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,255,0.9)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:shadow-none"
          >
            <span className="hidden sm:inline">Enviar</span>
            <IconoEnviar className="h-4 w-4 transition-transform group-enabled:group-hover:translate-x-0.5" />
          </button>
        </form>
        {error && conexion === 'lista' && <p className="mx-auto max-w-3xl px-1 pt-2 text-sm text-red-300">{error}</p>}
        <p className="mx-auto flex max-w-3xl items-center justify-center gap-1.5 px-1 pt-2 text-center text-[11px] text-slate-500">
          <IconoCandado className="h-3.5 w-3.5" /> Nunca compartas claves ni números de tarjeta por este chat.
        </p>
      </footer>
    </section>
  );
});

// ---------------------------------------------------------------------
// Estados de la conversación
// ---------------------------------------------------------------------
type Fase = 'conectando' | 'fallida' | 'escribiendo' | 'registrando' | 'en_linea' | 'asesor' | 'revisando' | 'registrado';

function faseConversacion({ conexion, estado, enviando, ultimo }: { conexion: string; estado: string; enviando: boolean; ultimo?: MensajeUI }): Fase {
  if (conexion === 'conectando') return 'conectando';
  if (conexion === 'fallida') return 'fallida';
  if (enviando) return ultimo?.tipo === 'resumen_pedido' ? 'registrando' : 'escribiendo';
  if (estado === 'escalada') return 'asesor';
  if (ultimo?.tipo === 'pedido_registrado') return 'registrado';
  if (ultimo?.tipo === 'resumen_pedido' || ultimo?.tipo === 'formulario_entrega') return 'revisando';
  return 'en_linea';
}

const TEXTO_FASE: Record<Fase, { texto: string; color: string }> = {
  conectando: { texto: 'Conectando…', color: 'text-amber-300' },
  fallida: { texto: 'Sin conexión', color: 'text-red-300' },
  escribiendo: { texto: 'Escribiendo…', color: 'text-electrico-300' },
  registrando: { texto: 'Confirmando pedido…', color: 'text-electrico-300' },
  en_linea: { texto: 'En línea', color: 'text-emerald-300' },
  asesor: { texto: 'Con un asesor', color: 'text-violet-300' },
  revisando: { texto: 'Preparando tu pedido', color: 'text-sky-300' },
  registrado: { texto: 'Pedido registrado', color: 'text-emerald-300' },
};

function EstadoFase({ fase }: { fase: Fase }) {
  const f = TEXTO_FASE[fase];
  return (
    <span className={`font-medium ${f.color}`} data-fase={fase}>
      {f.texto}
    </span>
  );
}

function Escribiendo({ registrando }: { registrando: boolean }) {
  return (
    <div role="status" className="mr-auto flex items-center gap-3 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-sm text-slate-300">
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-electrico-400" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      {registrando ? 'Registrando tu pedido…' : 'Don Repuestos está escribiendo…'}
    </div>
  );
}

function EstadoConexion({
  conexion,
  segundos,
  hayPendiente,
  error,
  onReintentar,
}: {
  conexion: 'conectando' | 'fallida';
  segundos: number;
  hayPendiente: boolean;
  error: string | null;
  onReintentar: () => void;
}) {
  if (conexion === 'fallida') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
        <p>{error ?? 'No pudimos conectar con el asistente.'}</p>
        <BotonChat onClick={onReintentar}>Reintentar</BotonChat>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
      <p className="flex items-center gap-2 text-slate-100">
        <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-electrico-400 border-t-transparent" />
        Conectando con el asistente… {segundos > 0 && <span className="tabular-nums text-slate-400">{segundos} s</span>}
      </p>
      {segundos >= 5 && <p className="text-slate-400">El servidor estaba en pausa por inactividad y se está despertando. Puede tardar hasta un minuto.</p>}
      <p className="text-slate-400">{hayPendiente ? 'Tu mensaje se enviará apenas conecte.' : 'Puedes ir escribiendo tu mensaje: lo enviamos apenas conecte.'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------
function Burbuja({ m, activo, onAccion }: { m: MensajeUI; activo: boolean; onAccion: (b: BotonAccion) => void }) {
  if (m.rol === 'cliente') {
    return (
      <div className="ml-auto max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-gradient-to-br from-electrico-500 to-electrico-600 px-4 py-2.5 text-sm text-white shadow-[0_10px_24px_-10px_rgba(37,99,255,0.9)]">
        {m.texto}
      </div>
    );
  }
  const estilo =
    m.tipo === 'error'
      ? 'border-red-400/30 bg-red-500/10 text-red-100'
      : m.tipo === 'escalado' || m.rol === 'asesor'
        ? 'border-violet-400/25 bg-violet-500/10 text-violet-100'
        : 'border-white/[0.08] bg-white/[0.05] text-slate-100';

  let contenido: ReactNode;
  if (m.tipo === 'productos' && Array.isArray((m.datos as { productos?: unknown })?.productos)) contenido = <ProductosChat m={m} activo={activo} onAccion={onAccion} />;
  else if (esTarjetaPedido(m.tipo)) contenido = <TarjetaPedido m={m} />;
  else contenido = <div className={`whitespace-pre-line rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm leading-relaxed ${estilo}`}>{m.texto}</div>;

  return (
    <div className="mr-auto flex w-full max-w-[94%] flex-col items-start gap-2">
      {m.rol === 'asesor' && <span className="text-xs font-medium text-violet-300">Asesor de Don Repuestos Jaimes</span>}
      {contenido}
      {m.tipo === 'formulario_entrega' && activo && (
        <FormularioEntrega
          valores={(m.datos as { valores?: Record<string, string> })?.valores ?? {}}
          onEnviar={(datos) => onAccion({ etiqueta: 'Enviar datos de entrega', accion: { tipo: 'datos_entrega', datos } })}
        />
      )}
      {activo && m.tipo !== 'productos' && m.acciones.length > 0 && <Acciones acciones={m.acciones} onAccion={onAccion} />}
    </div>
  );
}

function Acciones({ acciones, onAccion }: { acciones: BotonAccion[]; onAccion: (b: BotonAccion) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {acciones.map((a, i) => (
        <BotonChat key={i} variante={i === 0 ? 'primario' : 'secundario'} onClick={() => onAccion(a)}>
          {a.etiqueta}
        </BotonChat>
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
    <div className="flex w-full flex-col gap-3 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.05] p-3 text-sm sm:p-4">
      <p className="font-medium text-white">{encabezado}</p>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {productos.map((p, i) => {
          const d = p.disponibilidad;
          return (
            <li key={p.producto_id} className="group flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-noche-900/60 p-3 transition hover:border-electrico-400/40">
              <div className="flex flex-wrap items-center gap-1.5">
                {productos.length > 1 && <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Opción {i + 1}</span>}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.tipo === 'original' ? 'bg-electrico-500/20 text-electrico-300 ring-1 ring-electrico-400/30' : 'bg-white/10 text-slate-300'}`}
                >
                  {p.tipo === 'original' ? 'Original Yamaha' : `Genérico · ${p.marca}`}
                </span>
                {p.es_demo && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">Demo ficticio</span>}
              </div>
              <p className="font-semibold leading-snug text-white">{p.nombre}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-300">
                <dt className="text-slate-500">Referencia</dt>
                <dd className="font-mono">{p.referencia}</dd>
                <dt className="text-slate-500">Compatibilidad</dt>
                <dd>{p.compatibilidad.verificada ? `${p.compatibilidad.modelo} ${p.compatibilidad.anio_desde}–${p.compatibilidad.anio_hasta}` : 'Sin verificar (la confirma un asesor)'}</dd>
                <dt className="text-slate-500">Disponibilidad</dt>
                <dd className={d.estado === 'agotado' ? 'font-medium text-red-300' : 'text-emerald-300'}>
                  {d.estado === 'agotado'
                    ? `Agotado${d.tiempo_abastecimiento_dias ? ` · llega en ~${d.tiempo_abastecimiento_dias} días` : ''}`
                    : d.cantidad === null
                      ? 'Por confirmar'
                      : `${d.cantidad} ${d.cantidad === 1 ? 'unidad' : 'unidades'}`}
                </dd>
              </dl>
              <p className="font-display text-lg font-semibold tabular-nums text-white">
                {p.precio ? cop(p.precio) : <span className="font-sans text-sm font-normal text-slate-400">Precio por confirmar con un asesor</span>}
              </p>
              {activo && p.vendible && (
                <BotonChat onClick={() => onAccion({ etiqueta: `Agregar ${p.nombre} (${p.referencia})`, accion: { tipo: 'agregar', producto_id: p.producto_id, cantidad: 1 } })}>
                  <IconoMas className="h-4 w-4" /> Agregar al pedido
                </BotonChat>
              )}
            </li>
          );
        })}
      </ul>
      {notas.map((n, i) => (
        <p key={i} className={n.startsWith('⚠️') ? 'rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-amber-100' : 'text-slate-300'}>
          {n}
        </p>
      ))}
      {activo && otras.length > 0 && <Acciones acciones={otras} onAccion={onAccion} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Íconos (SVG en línea, sin dependencias)
// ---------------------------------------------------------------------
type PropsIcono = { className?: string };
const Svg = ({ className, children }: PropsIcono & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);
export const IconoAsistente = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M12 3v2M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" />
    <circle cx="9" cy="13.5" r="1.2" fill="currentColor" />
    <circle cx="15" cy="13.5" r="1.2" fill="currentColor" />
    <path d="M2 12v3M22 12v3" />
  </Svg>
);
const IconoEnviar = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </Svg>
);
const IconoNuevo = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
const IconoMas = IconoNuevo;
const IconoCandado = (p: PropsIcono) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
