import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorApi } from '../../api/cliente';
import { tienda, type DetalleProducto } from '../../api/tienda';
import { useDatos, useTienda } from '../estado';
import { Boton, Contenedor, EstadoError, EstadoVacio, Esqueleto, GrillaProductos, ImagenProducto, InsigniaDemo, InsigniaTipo, Precio, TextoDisponibilidad, cx, mensajeError } from '../ui';

/** Ficha de un repuesto: solo muestra lo que está registrado en la base de datos. */
export default function PaginaProducto() {
  const { slug = '' } = useParams();
  const prod = useDatos(() => tienda.producto(slug), [slug]);
  const relacionados = useDatos(() => tienda.relacionados(slug), [slug]);

  if (prod.cargando) {
    return (
      <Contenedor className="grid gap-8 py-10 md:grid-cols-2">
        <Esqueleto className="aspect-square" />
        <div className="space-y-4">
          <Esqueleto className="h-8 w-3/4" />
          <Esqueleto className="h-5 w-1/2" />
          <Esqueleto className="h-24" />
        </div>
      </Contenedor>
    );
  }
  if (prod.error || !prod.datos) {
    const noExiste = prod.error instanceof ErrorApi && prod.error.status === 404;
    return (
      <Contenedor className="py-16">
        {noExiste ? (
          <EstadoVacio titulo="No encontramos este repuesto" texto="Puede que ya no esté publicado. Busca otro en el catálogo.">
            <Link to="/catalogo" className="text-sm font-semibold text-electrico-300 hover:text-white">
              Ir al catálogo
            </Link>
          </EstadoVacio>
        ) : (
          <EstadoError error={prod.error} reintentar={prod.reintentar} />
        )}
      </Contenedor>
    );
  }

  const p = prod.datos;
  return (
    <Contenedor className="py-8 sm:py-10">
      <nav aria-label="Ruta" className="mb-6 text-xs text-gris-tec">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/catalogo" className="hover:text-white">
              Catálogo
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to={`/catalogo?categoria=${p.categoria.clave}`} className="hover:text-white">
              {p.categoria.etiqueta}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="truncate text-slate-300">
            {p.nombre}
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        <Galeria p={p} />
        <Resumen p={p} />
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Compatibilidades p={p} />
        <Especificaciones p={p} />
      </div>

      {(relacionados.datos?.length ?? 0) > 0 && (
        <section aria-labelledby="t-relacionados" className="mt-14">
          <h2 id="t-relacionados" className="mb-5 font-display text-xl font-semibold text-white">
            También te puede servir
          </h2>
          <GrillaProductos productos={relacionados.datos!.slice(0, 4)} />
        </section>
      )}
    </Contenedor>
  );
}

function Galeria({ p }: { p: DetalleProducto }) {
  const fotos = p.imagenes.length ? [...p.imagenes].sort((a, b) => Number(b.es_principal) - Number(a.es_principal)) : [];
  const [i, setI] = useState(0);
  const actual = fotos[i];
  return (
    <div>
      <div className="vidrio aspect-square overflow-hidden rounded-3xl p-4">
        <ImagenProducto url={actual?.url ?? null} alt={actual?.alt ?? p.nombre} categoria={p.categoria.clave} />
      </div>
      {fotos.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto">
          {fotos.map((f, n) => (
            <li key={f.url}>
              <button
                type="button"
                onClick={() => setI(n)}
                aria-label={`Ver foto ${n + 1}`}
                aria-pressed={n === i}
                className={cx('h-16 w-16 overflow-hidden rounded-xl border bg-noche-900/60 p-1', n === i ? 'border-electrico-400' : 'border-white/10')}
              >
                <img src={f.url} alt="" className="h-full w-full object-contain" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Resumen({ p }: { p: DetalleProducto }) {
  const { agregar, cliente, favoritos, alternarFavorito } = useTienda();
  const [cantidad, setCantidad] = useState(1);
  const [estado, setEstado] = useState<{ cargando: boolean; mensaje: string | null; ok: boolean }>({ cargando: false, mensaje: null, ok: false });
  const vendible = p.precio !== null && (p.disponibilidad === 'disponible' || p.disponibilidad === 'stock_bajo');
  const maximo = Math.max(1, Math.min(99, p.stock.cantidad ?? 99));
  const esFavorito = favoritos.has(p.id);

  const sumar = async () => {
    setEstado({ cargando: true, mensaje: null, ok: false });
    try {
      await agregar(p.id, cantidad);
      setEstado({ cargando: false, mensaje: 'Agregado al carrito.', ok: true });
    } catch (e) {
      setEstado({ cargando: false, mensaje: mensajeError(e), ok: false });
    }
  };
  const favorito = async () => {
    try {
      await alternarFavorito(p.id);
    } catch (e) {
      setEstado({ cargando: false, mensaje: mensajeError(e), ok: false });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <InsigniaTipo tipo={p.tipo} marca={p.marca} />
        {p.es_demo && <InsigniaDemo />}
      </div>
      <div>
        <h1 className="font-display text-2xl leading-tight font-bold text-white sm:text-3xl">{p.nombre}</h1>
        <p className="mt-2 text-sm text-gris-tec">
          Ref. {p.sku}
          {p.referencia ? ` · Referencia fabricante ${p.referencia}` : ''}
          {p.posicion ? ` · Posición ${p.posicion}` : ''}
        </p>
      </div>
      <Precio precio={p.precio} promocion={p.promocion} grande />
      {p.promocion?.termina_at && <p className="-mt-3 text-xs text-cian-300">Promoción válida hasta el {new Date(p.promocion.termina_at).toLocaleDateString('es-CO')}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TextoDisponibilidad estado={p.disponibilidad} className="text-sm" />
        {p.disponibilidad === 'agotado' && p.stock.tiempo_abastecimiento_dias !== null && (
          <span className="text-xs text-gris-tec">Llega en unos {p.stock.tiempo_abastecimiento_dias} días hábiles</span>
        )}
      </div>
      {p.descripcion && <p className="leading-relaxed text-slate-300">{p.descripcion}</p>}

      {p.advertencia_seguridad && (
        <div role="note" className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-100">
          <strong className="font-semibold">Pieza de seguridad.</strong> Confirma la compatibilidad con tu moto antes de comprar y haz la instalación con un mecánico calificado.
        </div>
      )}

      {vendible ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="cantidad" className="mb-1.5 block text-xs font-medium text-gris-tec">
              Cantidad
            </label>
            <div className="flex items-center rounded-xl border border-white/10 bg-noche-900/80">
              <button type="button" aria-label="Quitar una unidad" onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="h-11 w-11 text-lg text-slate-200 hover:text-white">
                −
              </button>
              <input
                id="cantidad"
                type="number"
                inputMode="numeric"
                min={1}
                max={maximo}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Math.min(maximo, Number(e.target.value) || 1)))}
                className="h-11 w-12 bg-transparent text-center text-white [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button type="button" aria-label="Agregar una unidad" onClick={() => setCantidad((c) => Math.min(maximo, c + 1))} className="h-11 w-11 text-lg text-slate-200 hover:text-white">
                +
              </button>
            </div>
          </div>
          <Boton onClick={sumar} cargando={estado.cargando} className="min-w-48 flex-1 py-3">
            Agregar al carrito
          </Boton>
        </div>
      ) : (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
          {p.precio === null ? 'Este repuesto aún no tiene precio confirmado.' : 'Este repuesto no está disponible en este momento.'} Pregúntale a Jaimes AI o escríbenos para cotizarlo.
        </p>
      )}
      <p aria-live="polite" className={cx('-mt-2 min-h-5 text-sm', estado.ok ? 'text-emerald-300' : 'text-rose-300')}>
        {estado.mensaje}
        {estado.ok && (
          <Link to="/carrito" className="ml-2 font-semibold text-electrico-300 underline-offset-4 hover:underline">
            Ver carrito
          </Link>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/asistente"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-100 transition hover:border-electrico-400/50 hover:bg-white/[0.06]"
        >
          Preguntar a Jaimes AI
        </Link>
        {cliente ? (
          <Boton variante="fantasma" onClick={favorito} aria-pressed={esFavorito}>
            {esFavorito ? '♥ En favoritos' : '♡ Guardar en favoritos'}
          </Boton>
        ) : (
          <Link to="/ingresar" className="inline-flex min-h-11 items-center px-3 text-sm text-gris-tec hover:text-white">
            Ingresa para guardar favoritos
          </Link>
        )}
      </div>
    </div>
  );
}

function Compatibilidades({ p }: { p: DetalleProducto }) {
  const { moto } = useTienda();
  const sirve = (c: DetalleProducto['compatibilidades'][number]) => moto && c.modelo_id === moto.modeloId && (!moto.anio || (moto.anio >= c.anio_desde && moto.anio <= c.anio_hasta));
  const paraMiMoto = moto ? p.compatibilidades.filter(sirve) : [];
  return (
    <section aria-labelledby="t-compat" className="vidrio rounded-3xl p-5 sm:p-6">
      <h2 id="t-compat" className="font-display text-lg font-semibold text-white">
        Motos compatibles
      </h2>
      {moto && (
        <p className={cx('mt-2 text-sm', paraMiMoto.length ? 'text-emerald-300' : 'text-amber-200')}>
          {paraMiMoto.length
            ? `Registrado como compatible con tu ${moto.fabricante} ${moto.modelo}${moto.anio ? ` ${moto.anio}` : ''}${paraMiMoto.some((c) => c.verificada) ? '' : ' (sin verificar todavía)'}.`
            : `No tenemos registrada compatibilidad con tu ${moto.fabricante} ${moto.modelo}${moto.anio ? ` ${moto.anio}` : ''}. Confírmala con un asesor antes de comprar.`}
        </p>
      )}
      {p.compatibilidades.length === 0 ? (
        <p className="mt-3 text-sm text-gris-tec">Todavía no hay compatibilidades registradas para este repuesto. Escríbenos con el modelo y año de tu moto.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {p.compatibilidades.map((c) => (
            <li key={`${c.modelo_id}-${c.anio_desde}-${c.version ?? ''}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="text-slate-200">
                {c.fabricante} {c.modelo}
                {c.version ? ` ${c.version}` : ''} · {c.anio_desde === c.anio_hasta ? c.anio_desde : `${c.anio_desde}–${c.anio_hasta}`}
                {c.notas && <span className="block text-xs text-gris-tec">{c.notas}</span>}
              </span>
              <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', c.verificada ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-gris-tec')}>
                {c.verificada ? 'Verificada' : 'Sin verificar'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Especificaciones({ p }: { p: DetalleProducto }) {
  const filas = Object.entries(p.especificaciones ?? {});
  return (
    <section aria-labelledby="t-specs" className="vidrio rounded-3xl p-5 sm:p-6">
      <h2 id="t-specs" className="font-display text-lg font-semibold text-white">
        Especificaciones
      </h2>
      {filas.length === 0 ? (
        <p className="mt-3 text-sm text-gris-tec">Sin especificaciones técnicas registradas.</p>
      ) : (
        <dl className="mt-4 divide-y divide-white/5 text-sm">
          {filas.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-gris-tec capitalize">{k.replace(/_/g, ' ')}</dt>
              <dd className="text-right text-slate-200">{typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 text-xs text-gris-tec">Marca: {p.marca}</p>
    </section>
  );
}
