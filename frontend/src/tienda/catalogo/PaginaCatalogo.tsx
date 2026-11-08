import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { tienda, type FiltrosCatalogo, type ModeloMoto } from '../../api/tienda';
import { Iconos } from '../../inicio/comunes';
import { useDatos, useTienda } from '../estado';
import { Boton, Contenedor, Esqueleto, EstadoError, EstadoVacio, GrillaProductos, cx } from '../ui';

const TAMANO = 24;
const CLAVES = ['q', 'categoria', 'fabricante', 'modelo', 'anio', 'tipo', 'disponible', 'precio_min', 'precio_max', 'orden', 'pagina'] as const;
const ORDENES = [
  ['relevancia', 'Más relevantes'],
  ['precio_asc', 'Menor precio'],
  ['precio_desc', 'Mayor precio'],
  ['nombre', 'Nombre (A–Z)'],
  ['recientes', 'Más recientes'],
] as const;

/** Catálogo: los filtros viven en la URL, así un enlace filtrado se puede compartir. */
export default function PaginaCatalogo() {
  const [params, setParams] = useSearchParams();
  const { moto, elegirMoto } = useTienda();
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const f = useMemo(() => Object.fromEntries(CLAVES.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)) as FiltrosCatalogo, [params]);
  const clave = params.toString();
  const datos = useDatos(() => tienda.productos({ ...f, tamano: TAMANO }), [clave]);
  const categorias = useDatos(() => tienda.categorias(), []);
  const fabricantes = useDatos(() => tienda.fabricantes(), []);
  const modelos = useDatos(() => (f.fabricante ? tienda.modelos(Number(f.fabricante)) : Promise.resolve([] as ModeloMoto[])), [f.fabricante]);

  const cambiar = (cambios: Partial<Record<(typeof CLAVES)[number], string | null>>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null || v === undefined || v === '') n.delete(k);
      else n.set(k, v);
    }
    if (!('pagina' in cambios)) n.delete('pagina');
    setParams(n);
  };
  const limpiar = () => setParams(f.q ? { q: f.q } : {});

  const categoriaActual = useMemo(() => {
    for (const g of categorias.datos ?? []) {
      if (g.clave === f.categoria) return g.etiqueta;
      const c = g.categorias.find((x) => x.clave === f.categoria);
      if (c) return c.etiqueta;
    }
    return null;
  }, [categorias.datos, f.categoria]);
  const fabricante = fabricantes.datos?.find((x) => String(x.id) === f.fabricante);
  const modelo = modelos.datos?.find((x) => String(x.id) === f.modelo);
  const nombreMoto = fabricante ? `${fabricante.nombre}${modelo ? ` ${modelo.nombre}` : ''}${modelo && f.anio ? ` ${f.anio}` : ''}` : undefined;

  // Si llega a /catalogo sin moto en la URL pero el cliente ya eligió una, se le ofrece aplicarla
  const ofrecerMoto = moto && !f.modelo && !f.fabricante;
  const titulo = f.q ? `Resultados para “${f.q}”` : categoriaActual ?? (nombreMoto ? `Repuestos para ${nombreMoto}` : 'Catálogo de repuestos');
  const pagina = Number(f.pagina ?? 1);
  const total = datos.datos?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAMANO));

  const panel = (
    <Filtros
      f={f}
      cambiar={cambiar}
      limpiar={limpiar}
      grupos={categorias.datos ?? []}
      fabricantes={fabricantes.datos ?? []}
      modelos={modelos.datos ?? []}
    />
  );

  return (
    <Contenedor className="py-8 sm:py-12">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-[0.18em] text-electrico-300 uppercase">Catálogo</p>
        <h1 className="font-display text-2xl font-semibold text-white sm:text-4xl">{titulo}</h1>
        <p aria-live="polite" className="text-sm text-gris-tec">
          {datos.cargando ? 'Buscando…' : datos.datos ? `${total} ${total === 1 ? 'producto' : 'productos'}` : ''}
        </p>
      </div>

      {ofrecerMoto && (
        <div className="vidrio mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 sm:p-4">
          <p className="text-sm text-slate-200">
            ¿Ver solo lo compatible con tu{' '}
            <strong className="text-white">
              {moto.fabricante} {moto.modelo}
              {moto.anio ? ` ${moto.anio}` : ''}
            </strong>
            ?
          </p>
          <div className="flex gap-2">
            <Boton onClick={() => cambiar({ fabricante: String(moto.fabricanteId), modelo: String(moto.modeloId), anio: moto.anio ? String(moto.anio) : null })}>Sí, filtrar</Boton>
            <Boton variante="fantasma" onClick={() => elegirMoto(null)}>
              Olvidar moto
            </Boton>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Boton variante="secundario" className="lg:hidden" onClick={() => setFiltrosAbiertos(true)} aria-expanded={filtrosAbiertos} aria-controls="filtros-movil">
          <IconoFiltro className="h-4 w-4" /> Filtros
        </Boton>
        <Activos f={f} cambiar={cambiar} categoria={categoriaActual} moto={nombreMoto} />
        <label className="ml-auto flex items-center gap-2 text-sm text-gris-tec">
          <span className="hidden sm:inline">Ordenar por</span>
          <select
            value={f.orden ?? 'relevancia'}
            onChange={(e) => cambiar({ orden: e.target.value === 'relevancia' ? null : e.target.value })}
            className="rounded-xl border border-white/10 bg-noche-900/80 px-3 py-2.5 text-sm text-white focus:border-electrico-400 focus:outline-none"
          >
            {ORDENES.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Filtros" className="hidden lg:block">
          {panel}
        </aside>

        {filtrosAbiertos && (
          <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Filtros" id="filtros-movil">
            <button type="button" aria-label="Cerrar filtros" className="absolute inset-0 bg-black/60" onClick={() => setFiltrosAbiertos(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[min(88vw,340px)] flex-col bg-noche-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <p className="font-display font-semibold text-white">Filtros</p>
                <button type="button" onClick={() => setFiltrosAbiertos(false)} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10">
                  <Iconos.cerrar className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">{panel}</div>
              <div className="border-t border-white/10 p-4">
                <Boton className="w-full" onClick={() => setFiltrosAbiertos(false)}>
                  Ver {total} {total === 1 ? 'producto' : 'productos'}
                </Boton>
              </div>
            </div>
          </div>
        )}

        <section aria-label="Productos">
          {datos.cargando && (
            <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Esqueleto key={i} className="h-96" />
              ))}
            </div>
          )}
          {datos.error && <EstadoError error={datos.error} reintentar={datos.reintentar} />}
          {datos.datos && !datos.datos.items.length && (
            <EstadoVacio
              titulo="No encontramos repuestos con esos filtros"
              texto={f.modelo ? 'Puede que aún no tengamos la compatibilidad verificada para esa moto. Jaimes AI o un asesor te pueden ayudar a confirmarlo.' : 'Prueba con otras palabras o quita algún filtro.'}
            >
              <div className="flex flex-wrap justify-center gap-2">
                <Boton variante="secundario" onClick={limpiar}>
                  Quitar filtros
                </Boton>
              </div>
            </EstadoVacio>
          )}
          {datos.datos && datos.datos.items.length > 0 && (
            <>
              <GrillaProductos productos={datos.datos.items} />
              {paginas > 1 && (
                <nav aria-label="Paginación" className="mt-8 flex items-center justify-center gap-2">
                  <Boton variante="secundario" disabled={pagina <= 1} onClick={() => cambiar({ pagina: String(pagina - 1) })}>
                    Anterior
                  </Boton>
                  <span className="px-3 text-sm text-gris-tec">
                    Página {pagina} de {paginas}
                  </span>
                  <Boton variante="secundario" disabled={pagina >= paginas} onClick={() => cambiar({ pagina: String(pagina + 1) })}>
                    Siguiente
                  </Boton>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </Contenedor>
  );
}

function Activos({ f, cambiar, categoria, moto }: { f: FiltrosCatalogo; cambiar: (c: Record<string, string | null>) => void; categoria: string | null; moto?: string }) {
  const chips: { texto: string; quitar: Record<string, null> }[] = [];
  if (f.q) chips.push({ texto: `“${f.q}”`, quitar: { q: null } });
  if (categoria) chips.push({ texto: categoria, quitar: { categoria: null } });
  if (f.fabricante || f.modelo) chips.push({ texto: `Moto: ${moto ?? '…'}`, quitar: { fabricante: null, modelo: null, anio: null } });
  if (f.tipo) chips.push({ texto: { original: 'Originales', generico: 'Genéricos', alternativo: 'Alternativos' }[f.tipo] ?? f.tipo, quitar: { tipo: null } });
  if (f.disponible === 'true') chips.push({ texto: 'Disponibles', quitar: { disponible: null } });
  if (f.precio_min || f.precio_max) chips.push({ texto: `Precio ${f.precio_min ?? '0'}–${f.precio_max ?? '∞'}`, quitar: { precio_min: null, precio_max: null } });
  return (
    <ul className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <li key={c.texto}>
          <button
            type="button"
            onClick={() => cambiar(c.quitar)}
            aria-label={`Quitar filtro ${c.texto}`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-electrico-400/30 bg-electrico-500/10 px-3 text-xs font-medium text-electrico-200 transition hover:bg-electrico-500/20"
          >
            {c.texto}
            <Iconos.cerrar className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="border-b border-white/[0.06] pb-5">
      <legend className="mb-3 text-xs font-semibold tracking-[0.16em] text-gris-tec uppercase">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Filtros({
  f,
  cambiar,
  limpiar,
  modelos,
  grupos,
  fabricantes,
}: {
  f: FiltrosCatalogo;
  cambiar: (c: Record<string, string | null>) => void;
  limpiar: () => void;
  grupos: { clave: string; etiqueta: string; categorias: { clave: string; etiqueta: string }[] }[];
  fabricantes: { id: number; nombre: string; modelos: number }[];
  modelos: ModeloMoto[];
}) {
  const [min, setMin] = useState(f.precio_min ?? '');
  const [max, setMax] = useState(f.precio_max ?? '');
  useEffect(() => {
    setMin(f.precio_min ?? '');
    setMax(f.precio_max ?? '');
  }, [f.precio_min, f.precio_max]);
  const sel = 'w-full rounded-xl border border-white/10 bg-noche-950/60 px-3 py-2.5 text-sm text-white focus:border-electrico-400 focus:outline-none';
  const radio = (activo: boolean) => cx('flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition', activo ? 'bg-electrico-500/15 font-semibold text-white' : 'text-slate-300 hover:bg-white/[0.05]');

  return (
    <div className="flex flex-col gap-5">
      <Grupo titulo="Tu moto">
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="f-marca">
            Marca
          </label>
          <select id="f-marca" className={sel} value={f.fabricante ?? ''} onChange={(e) => cambiar({ fabricante: e.target.value || null, modelo: null, anio: null })}>
            <option value="">Todas las marcas</option>
            {fabricantes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="f-modelo">
            Modelo
          </label>
          <select id="f-modelo" className={sel} disabled={!f.fabricante} value={f.modelo ?? ''} onChange={(e) => cambiar({ modelo: e.target.value || null })}>
            <option value="">Todos los modelos</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="f-anio">
            Año
          </label>
          <input
            id="f-anio"
            type="number"
            inputMode="numeric"
            min={1980}
            max={new Date().getFullYear() + 1}
            placeholder="Año (ej. 2019)"
            disabled={!f.modelo}
            defaultValue={f.anio ?? ''}
            key={f.anio ?? 'sin'}
            onBlur={(e) => cambiar({ anio: /^\d{4}$/.test(e.target.value) ? e.target.value : null })}
            className={sel}
          />
          <p className="text-xs text-gris-tec">Solo se muestran repuestos con compatibilidad verificada.</p>
        </div>
      </Grupo>

      <Grupo titulo="Categoría">
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto pr-1">
          <li>
            <button type="button" className={radio(!f.categoria)} onClick={() => cambiar({ categoria: null })}>
              Todas
            </button>
          </li>
          {grupos.map((g) => (
            <li key={g.clave}>
              <button type="button" className={radio(f.categoria === g.clave)} onClick={() => cambiar({ categoria: g.clave })}>
                {g.etiqueta}
              </button>
              <ul className="ml-3 border-l border-white/[0.06] pl-2">
                {g.categorias.map((c) => (
                  <li key={c.clave}>
                    <button type="button" className={radio(f.categoria === c.clave)} onClick={() => cambiar({ categoria: c.clave })}>
                      {c.etiqueta}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Grupo>

      <Grupo titulo="Tipo de repuesto">
        <div className="flex flex-col gap-0.5">
          {[
            ['', 'Todos'],
            ['original', 'Original del fabricante'],
            ['generico', 'Genérico'],
            ['alternativo', 'Alternativo'],
          ].map(([v, t]) => (
            <button key={v} type="button" aria-pressed={(f.tipo ?? '') === v} className={radio((f.tipo ?? '') === v)} onClick={() => cambiar({ tipo: v || null })}>
              {t}
            </button>
          ))}
        </div>
      </Grupo>

      <Grupo titulo="Precio (COP)">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            cambiar({ precio_min: min || null, precio_max: max || null });
          }}
        >
          <label className="sr-only" htmlFor="f-min">
            Precio mínimo
          </label>
          <input id="f-min" type="number" inputMode="numeric" min={0} placeholder="Mín." value={min} onChange={(e) => setMin(e.target.value)} className={sel} />
          <span className="text-gris-tec">–</span>
          <label className="sr-only" htmlFor="f-max">
            Precio máximo
          </label>
          <input id="f-max" type="number" inputMode="numeric" min={0} placeholder="Máx." value={max} onChange={(e) => setMax(e.target.value)} className={sel} />
          <button type="submit" aria-label="Aplicar precio" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-electrico-500 text-white">
            <Iconos.flecha className="h-4 w-4" />
          </button>
        </form>
      </Grupo>

      <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-200">
        <input type="checkbox" className="h-5 w-5 accent-electrico-500" checked={f.disponible === 'true'} onChange={(e) => cambiar({ disponible: e.target.checked ? 'true' : null })} />
        Solo disponibles
      </label>

      <Boton variante="fantasma" onClick={limpiar}>
        Limpiar filtros
      </Boton>
    </div>
  );
}

const IconoFiltro = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} aria-hidden>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);
