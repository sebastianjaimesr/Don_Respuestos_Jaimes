import { m } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api/cliente';
import { BotonPrincipal, EncabezadoSeccion, Iconos, Logo, Revelar, irAlAsistente } from './comunes';
import { IMAGEN_POR_CATEGORIA } from './imagenes';

type Preguntar = (texto: string) => void;

// =====================================================================
// Características
// =====================================================================
const CARACTERISTICAS = [
  {
    icono: Iconos.escudo,
    titulo: 'Compra segura',
    texto: 'Revisas el resumen antes de confirmar y el pago se coordina con un asesor. Nunca te pedimos claves ni datos de tarjeta.',
  },
  {
    icono: Iconos.rayo,
    titulo: 'Atención rápida',
    texto: 'El asistente responde al instante con precio y disponibilidad del inventario, y te pasa con una persona cuando lo necesitas.',
  },
  {
    icono: Iconos.medalla,
    titulo: 'Repuestos de calidad',
    texto: 'Originales Yamaha y genéricos claramente identificados, con la compatibilidad de tu modelo y año a la vista.',
  },
];

export function Caracteristicas() {
  return (
    <section id="caracteristicas" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:py-28">
      <div className="grid gap-5 md:grid-cols-3">
        {CARACTERISTICAS.map((c, i) => (
          <Revelar key={c.titulo} retraso={i * 0.1}>
            <article className="group vidrio relative h-full overflow-hidden rounded-3xl p-7 transition duration-500 hover:-translate-y-1.5 hover:border-electrico-400/40">
              <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-electrico-500/0 blur-3xl transition duration-500 group-hover:bg-electrico-500/30" />
              <span className="relative mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-electrico-400/25 to-electrico-600/10 text-electrico-300 ring-1 ring-electrico-400/30 transition duration-500 group-hover:scale-110 group-hover:text-white">
                <c.icono className="h-7 w-7" />
              </span>
              <h3 className="relative font-display text-xl font-semibold text-white">{c.titulo}</h3>
              <p className="relative mt-3 leading-relaxed text-slate-400">{c.texto}</p>
            </article>
          </Revelar>
        ))}
      </div>
    </section>
  );
}

// =====================================================================
// Catálogo (categorías y modelos reales del backend)
// =====================================================================
interface Categoria {
  clave: string;
  etiqueta: string;
  requierePosicion: boolean;
  seguridad: boolean;
}

function useDatos<T>(ruta: string) {
  const [estado, setEstado] = useState<{ datos: T | null; cargando: boolean; error: boolean }>({ datos: null, cargando: true, error: false });
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true, error: false }));
    api<T>(ruta)
      .then((datos) => vivo && setEstado({ datos, cargando: false, error: false }))
      .catch(() => vivo && setEstado({ datos: null, cargando: false, error: true }));
    return () => {
      vivo = false;
    };
  }, [ruta, intento]);
  return { ...estado, reintentar: () => setIntento((x) => x + 1) };
}

export function Catalogo({ preguntar }: { preguntar: Preguntar }) {
  const categorias = useDatos<Categoria[]>('/categorias');
  const modelos = useDatos<{ id: number; nombre: string }[]>('/modelos');
  const consultar = (t: string) => irAlAsistente(() => preguntar(t));

  const destacadas = (categorias.datos ?? []).filter((c) => IMAGEN_POR_CATEGORIA[c.clave]);
  const otras = (categorias.datos ?? []).filter((c) => !IMAGEN_POR_CATEGORIA[c.clave]);

  return (
    <section id="catalogo" className="relative scroll-mt-20 py-20 sm:py-28">
      <div aria-hidden className="absolute inset-x-0 top-1/3 -z-10 h-[60%] bg-[radial-gradient(ellipse_at_center,rgba(37,99,255,0.12),transparent_65%)]" />
      <div className="mx-auto max-w-6xl px-5">
        <EncabezadoSeccion
          etiqueta="Catálogo"
          titulo={
            <>
              Todo para tu Yamaha, <span className="texto-electrico">en un solo lugar</span>
            </>
          }
          texto="Elige una categoría y el asistente te pregunta el modelo y el año de tu moto para mostrarte solo lo que le sirve, con precio y disponibilidad reales."
        />

        {categorias.cargando && (
          <div className="mt-14 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4" aria-label="Cargando catálogo">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="vidrio h-80 animate-pulse rounded-3xl" />
            ))}
          </div>
        )}

        {categorias.error && (
          <Revelar className="vidrio mx-auto mt-14 flex max-w-xl flex-col items-center gap-4 rounded-3xl p-8 text-center">
            <p className="text-slate-300">No pudimos cargar el catálogo en este momento. Si el servidor estaba en pausa, tarda unos segundos en despertar.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <BotonPrincipal variante="vidrio" onClick={categorias.reintentar}>
                Reintentar
              </BotonPrincipal>
              <BotonPrincipal onClick={() => irAlAsistente()}>Consultar con asistente</BotonPrincipal>
            </div>
          </Revelar>
        )}

        {destacadas.length > 0 && (
          <ul className="mt-14 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {destacadas.map((c, i) => {
              const img = IMAGEN_POR_CATEGORIA[c.clave]!;
              return (
                <li key={c.clave}>
                  <Revelar retraso={i * 0.08} className="h-full">
                    <button
                      type="button"
                      onClick={() => consultar(`Busco ${c.etiqueta.toLowerCase()}`)}
                      className="group vidrio relative flex h-full w-full flex-col overflow-hidden rounded-3xl p-3.5 text-left sm:p-5 transition duration-500 hover:-translate-y-1.5 hover:border-electrico-400/50 hover:shadow-[0_30px_60px_-30px_rgba(37,99,255,0.8)]"
                    >
                      <div className="relative grid aspect-square place-items-center">
                        <div aria-hidden className="absolute inset-[18%] rounded-full bg-electrico-500/25 blur-2xl transition duration-500 group-hover:bg-electrico-500/45" />
                        <img
                          src={img.src}
                          srcSet={img.srcSet}
                          sizes="(min-width:1024px) 240px, (min-width:640px) 45vw, 85vw"
                          alt={img.alt}
                          loading="lazy"
                          decoding="async"
                          width={480}
                          height={480}
                          className="absolute inset-0 m-auto h-[82%] w-[82%] object-contain drop-shadow-[0_24px_30px_rgba(0,0,0,0.6)] transition duration-700 group-hover:scale-110 group-hover:-rotate-3"
                        />
                      </div>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                        <div>
                          <h3 className="font-display text-base font-semibold text-white sm:text-lg">{c.etiqueta}</h3>
                          <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">{c.seguridad ? 'Con verificación de compatibilidad' : 'Para tu modelo y año'}</p>
                        </div>
                        <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 sm:grid text-slate-300 transition duration-300 group-hover:border-transparent group-hover:bg-electrico-500 group-hover:text-white">
                          <Iconos.flecha className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </button>
                  </Revelar>
                </li>
              );
            })}
          </ul>
        )}

        {otras.length > 0 && (
          <Revelar className="mt-5">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {otras.map((c) => (
                <li key={c.clave}>
                  <button
                    type="button"
                    onClick={() => consultar(`Busco ${c.etiqueta.toLowerCase()}`)}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5 text-left transition duration-300 hover:border-electrico-400/40 hover:bg-white/[0.06]"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-electrico-500/10 text-electrico-300 ring-1 ring-electrico-400/20 transition group-hover:bg-electrico-500 group-hover:text-white">
                      <Iconos.engranaje className="h-5 w-5" />
                    </span>
                    <span className="flex-1 font-medium text-slate-200">{c.etiqueta}</span>
                    <Iconos.flecha className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-white" />
                  </button>
                </li>
              ))}
            </ul>
          </Revelar>
        )}

        {modelos.datos && modelos.datos.length > 0 && (
          <Revelar className="mt-12 flex flex-col items-center gap-4 text-center">
            <p className="text-sm font-medium tracking-wide text-slate-400">Modelos con referencias en el catálogo</p>
            <ul className="flex max-w-4xl flex-wrap justify-center gap-2">
              {modelos.datos.map((mo) => (
                <li key={mo.id}>
                  <button
                    type="button"
                    onClick={() => consultar(`Tengo una ${mo.nombre}, ¿qué repuestos tienen?`)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-electrico-400/50 hover:bg-electrico-500/15 hover:text-white"
                  >
                    {mo.nombre}
                  </button>
                </li>
              ))}
            </ul>
          </Revelar>
        )}
      </div>
    </section>
  );
}

// =====================================================================
// Servicios (lo que el sistema hace hoy, sin promesas inventadas)
// =====================================================================
const SERVICIOS = [
  { icono: Iconos.chat, titulo: 'Asesoría con asistente virtual', texto: 'Dile qué necesitas con tus palabras. Te pregunta modelo, año y posición cuando hace falta.' },
  { icono: Iconos.check, titulo: 'Verificación de compatibilidad', texto: 'Cada opción indica si la compatibilidad está verificada. En frenos, dirección y llantas te lo advertimos siempre.' },
  { icono: Iconos.documento, titulo: 'Cotizaciones con código', texto: 'Arma tu pedido y recibe una cotización con código, subtotal y vigencia para decidir con calma.' },
  { icono: Iconos.camion, titulo: 'Recogida o envío', texto: 'Recoge en tienda o pide envío a tu dirección. El costo del envío se confirma antes de pagar.' },
  { icono: Iconos.persona, titulo: 'Atención con un asesor', texto: '¿Un caso especial? El asistente le pasa tu conversación a una persona del equipo, sin repetir nada.' },
  { icono: Iconos.tarjeta, titulo: 'Pago coordinado', texto: 'Nequi, Daviplata, transferencia, efectivo o contraentrega, sujeto a confirmación del negocio.' },
];

export function Servicios() {
  return (
    <section id="servicios" className="relative mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-28">
      <EncabezadoSeccion
        etiqueta="Servicios"
        titulo={
          <>
            Del repuesto correcto <span className="texto-electrico">a tus manos</span>
          </>
        }
        texto="Un proceso claro de principio a fin: consultas, confirmas y nosotros coordinamos el resto."
      />
      <ol className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-3">
        {SERVICIOS.map((s, i) => (
          <li key={s.titulo} className="bg-noche-950">
            <Revelar retraso={(i % 3) * 0.08} className="group relative h-full p-7 transition duration-500 hover:bg-noche-900">
              <div className="flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-electrico-300 ring-1 ring-white/10 transition duration-500 group-hover:bg-electrico-500 group-hover:text-white group-hover:ring-transparent">
                  <s.icono className="h-6 w-6" />
                </span>
                <span className="font-display text-sm font-semibold text-slate-600 tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="mt-6 font-display text-lg font-semibold text-white">{s.titulo}</h3>
              <p className="mt-2 leading-relaxed text-slate-400">{s.texto}</p>
            </Revelar>
          </li>
        ))}
      </ol>
    </section>
  );
}

// =====================================================================
// Asistente virtual (contenedor de la sección)
// =====================================================================
const EJEMPLOS = ['Pastillas delanteras para FZ 2.0 2018', 'Filtro de aceite', 'Kit de arrastre', 'Quiero hablar con un asesor'];

export function SeccionAsistente({ preguntar, children }: { preguntar: Preguntar; children: ReactNode }) {
  return (
    <section id="asistente" className="relative scroll-mt-20 py-20 sm:py-28">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_70%_50%,rgba(37,99,255,0.18),transparent_70%)]" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col gap-8">
          <EncabezadoSeccion
            centrado={false}
            etiqueta="Asistente virtual"
            titulo={
              <>
                Tu asesor de repuestos, <span className="texto-electrico">disponible al instante</span>
              </>
            }
            texto="Consulta, cotiza y deja tu pedido registrado sin salir de esta página."
          />
          <Revelar retraso={0.1}>
            <ol className="flex flex-col gap-4">
              {[
                ['Cuéntale qué necesitas', 'El repuesto, el modelo y el año de tu Yamaha.'],
                ['Elige la mejor opción', 'Compara originales y genéricos con precio y disponibilidad.'],
                ['Confirma la entrega', 'Llena tus datos, revisa el resumen y confirma. Te damos un código de pedido.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-electrico-400/40 bg-electrico-500/10 font-display text-sm font-semibold text-electrico-300">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-white">{t}</p>
                    <p className="text-sm text-slate-400">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Revelar>
          <Revelar retraso={0.2} className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">Prueba con</p>
            <div className="flex flex-wrap gap-2">
              {EJEMPLOS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => irAlAsistente(() => preguntar(e))}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-left text-sm text-slate-300 transition hover:-translate-y-0.5 hover:border-electrico-400/50 hover:text-white active:scale-95"
                >
                  “{e}”
                </button>
              ))}
            </div>
          </Revelar>
        </div>
        <m.div
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
          id="panel-asistente"
        >
          <div aria-hidden className="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-electrico-500/30 via-transparent to-cian-400/10 blur-2xl" />
          {children}
        </m.div>
      </div>
    </section>
  );
}

// =====================================================================
// Contacto (datos confirmados por el negocio; lo pendiente se dice)
// =====================================================================
type Negocio = Record<string, { valor: unknown; confirmado: boolean } | undefined>;

const mostrar = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.map((x) => String(x).charAt(0).toUpperCase() + String(x).slice(1)).join(', ');
  if (typeof v === 'object') return null;
  return String(v);
};

export function Contacto({ preguntar }: { preguntar: Preguntar }) {
  const negocio = useDatos<Negocio>('/negocio');
  const dato = (k: string) => {
    const d = negocio.datos?.[k];
    return d?.confirmado ? mostrar(d.valor) : null;
  };
  const items = [
    { icono: Iconos.reloj, titulo: 'Horario', valor: dato('horario') },
    { icono: Iconos.ubicacion, titulo: 'Dirección', valor: dato('direccion') },
    { icono: Iconos.telefono, titulo: 'Contacto con un asesor', valor: dato('contacto_humano') },
    { icono: Iconos.camion, titulo: 'Ciudades de envío', valor: dato('ciudades_envio') },
  ];

  return (
    <section id="contacto" className="relative mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-28">
      <Revelar>
        <div className="vidrio relative overflow-hidden rounded-[32px] p-7 sm:p-12">
          <div aria-hidden className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-electrico-500/30 blur-3xl" />
          <div className="relative grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div className="flex flex-col items-start gap-5">
              <span className="text-[11px] font-semibold tracking-[0.18em] text-electrico-300 uppercase">Contacto</span>
              <h2 className="font-display text-3xl leading-tight font-semibold text-white sm:text-4xl">¿Listo para encontrar tu repuesto?</h2>
              <p className="max-w-md leading-relaxed text-slate-400">
                Escríbele al asistente o pide que te atienda una persona del equipo. Tu conversación queda guardada para continuar cuando quieras.
              </p>
              <div className="flex flex-wrap gap-3">
                <BotonPrincipal onClick={() => irAlAsistente()}>
                  <Iconos.chat className="h-5 w-5" />
                  Abrir asistente
                </BotonPrincipal>
                <BotonPrincipal variante="vidrio" onClick={() => irAlAsistente(() => preguntar('Quiero hablar con un asesor'))}>
                  <Iconos.persona className="h-5 w-5 text-electrico-300" />
                  Hablar con un asesor
                </BotonPrincipal>
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {items.map((it) => (
                <li key={it.titulo} className="flex gap-3 rounded-2xl border border-white/[0.07] bg-noche-950/40 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-electrico-500/10 text-electrico-300">
                    <it.icono className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium tracking-wide text-slate-500">{it.titulo}</p>
                    {negocio.cargando ? (
                      <p className="mt-1 h-4 w-28 animate-pulse rounded bg-white/10" />
                    ) : (
                      <p className={`mt-0.5 text-sm ${it.valor ? 'text-slate-100' : 'text-slate-500 italic'}`}>{it.valor ?? 'Por confirmar'}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Revelar>
    </section>
  );
}

// =====================================================================
// Pie de página
// =====================================================================
export function Pie() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-sm text-slate-500">Repuestos para motos Yamaha en Colombia, con asistente virtual de ventas.</p>
        </div>
        <nav aria-label="Pie de página" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
          <a href="#inicio" className="hover:text-white">
            Inicio
          </a>
          <a href="#catalogo" className="hover:text-white">
            Catálogo
          </a>
          <a href="#servicios" className="hover:text-white">
            Servicios
          </a>
          <a href="#contacto" className="hover:text-white">
            Contacto
          </a>
          <Link to="/admin" className="hover:text-white">
            Panel del negocio
          </Link>
        </nav>
      </div>
      <p className="border-t border-white/[0.04] py-5 text-center text-xs text-slate-600">© {new Date().getFullYear()} Don Repuestos Jaimes · Yamaha es una marca de su respectivo titular.</p>
    </footer>
  );
}
