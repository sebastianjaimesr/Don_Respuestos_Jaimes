import { useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { PanelChat, type ControlChat } from '../chat/PanelChat';
import { tienda } from '../api/tienda';
import { useDatos } from '../tienda/estado';
import { Contenedor, Esqueleto, GrillaProductos } from '../tienda/ui';
import { EncabezadoSeccion, Iconos, Revelar } from './comunes';
import { Hero } from './Hero';
import { Caracteristicas, Catalogo, Contacto, SeccionAsistente, Servicios } from './Secciones';

/** Portada: "¿QUÉ NECESITAS PARA TU MOTO?", marcas, categorías, destacados y Jaimes AI. */
export default function PaginaInicio() {
  const chat = useRef<ControlChat>(null);
  const preguntar = useCallback((t: string) => {
    chat.current?.preguntar(t);
    chat.current?.enfocar();
  }, []);
  const enfocarChat = useCallback(() => chat.current?.enfocar(), []);

  return (
    <>
      <Hero onAsistente={enfocarChat} />
      <Marcas />
      <Catalogo />
      <Destacados />
      <Caracteristicas />
      <Servicios />
      <SeccionAsistente preguntar={preguntar}>
        <PanelChat ref={chat} className="h-[min(72svh,720px)] min-h-[500px] sm:h-[min(74svh,700px)]" />
      </SeccionAsistente>
      <Contacto preguntar={preguntar} />
    </>
  );
}

function Marcas() {
  const f = useDatos(() => tienda.fabricantes(), []);
  if (f.error || (f.datos && !f.datos.length)) return null;
  return (
    <section aria-labelledby="titulo-marcas" className="border-y border-white/[0.06] bg-noche-900/40 py-8">
      <Contenedor>
        <h2 id="titulo-marcas" className="text-center text-xs font-semibold tracking-[0.2em] text-gris-tec uppercase">
          Repuestos por marca de moto
        </h2>
        <ul className="mt-5 flex flex-wrap justify-center gap-2 sm:gap-3">
          {f.cargando
            ? Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} className="h-11 w-24" />)
            : f.datos!.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/catalogo?fabricante=${m.id}`}
                    className="inline-flex h-11 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 font-display text-sm font-semibold tracking-wide text-slate-200 transition hover:-translate-y-0.5 hover:border-electrico-400/50 hover:bg-electrico-500/15 hover:text-white"
                  >
                    {m.nombre}
                  </Link>
                </li>
              ))}
        </ul>
      </Contenedor>
    </section>
  );
}

function Destacados() {
  const d = useDatos(() => tienda.destacados(), []);
  if (d.error || (d.datos && !d.datos.length)) return null;
  return (
    <section className="py-16 sm:py-24">
      <Contenedor>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <EncabezadoSeccion centrado={false} etiqueta="Destacados" titulo="Repuestos destacados" />
          <Revelar>
            <Link to="/catalogo" className="inline-flex items-center gap-2 text-sm font-semibold text-electrico-300 hover:text-white">
              Ver todo el catálogo <Iconos.flecha className="h-4 w-4" />
            </Link>
          </Revelar>
        </div>
        <div className="mt-10">
          {d.cargando ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Esqueleto key={i} className="h-96" />
              ))}
            </div>
          ) : (
            <GrillaProductos productos={d.datos!.slice(0, 8)} />
          )}
        </div>
      </Contenedor>
    </section>
  );
}
