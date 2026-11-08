import { useState } from 'react';
import { Link } from 'react-router';
import { cop } from '../../api/formato';
import type { ItemCarrito } from '../../api/tienda';
import { useTienda } from '../estado';
import { Boton, Contenedor, EstadoVacio, Esqueleto, InsigniaDemo, InsigniaTipo, cx, mensajeError } from '../ui';

const PROBLEMA: Record<NonNullable<ItemCarrito['problema']>, string> = {
  producto_inactivo: 'Este repuesto ya no está publicado. Quítalo para continuar.',
  precio_no_confirmado: 'Su precio aún no está confirmado. Quítalo o consúltalo con un asesor.',
  agotado: 'Se agotó. Quítalo para continuar.',
  stock_insuficiente: 'No hay tantas unidades disponibles. Baja la cantidad.',
};

/** Carrito: los precios y la disponibilidad los calcula el servidor en cada consulta. */
export default function PaginaCarrito() {
  const { carrito, cargandoCarrito } = useTienda();
  const items = carrito?.items ?? [];

  if (cargandoCarrito && !carrito) {
    return (
      <Contenedor className="space-y-3 py-10">
        <Esqueleto className="h-24" />
        <Esqueleto className="h-24" />
      </Contenedor>
    );
  }

  return (
    <Contenedor className="py-8 sm:py-10">
      <h1 className="mb-6 font-display text-2xl font-bold text-white sm:text-3xl">Tu carrito</h1>
      {items.length === 0 ? (
        <EstadoVacio titulo="Tu carrito está vacío" texto="Busca el repuesto que necesitas o elige tu moto para ver lo compatible.">
          <Link to="/catalogo" className="text-sm font-semibold text-electrico-300 hover:text-white">
            Ir al catálogo
          </Link>
        </EstadoVacio>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <ul className="space-y-3">
            {items.map((it) => (
              <Linea key={it.producto_id} it={it} />
            ))}
          </ul>
          <aside className="vidrio h-fit rounded-3xl p-5 lg:sticky lg:top-24">
            <h2 className="font-display text-lg font-semibold text-white">Resumen</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gris-tec">Subtotal</dt>
                <dd className="font-semibold text-white">{cop(carrito!.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gris-tec">Envío</dt>
                <dd className="text-slate-300">Se calcula al confirmar</dd>
              </div>
            </dl>
            {carrito!.listo_para_pedido ? (
              <Link
                to="/checkout"
                className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gradient-to-br from-electrico-400 to-electrico-600 px-4 font-semibold text-white shadow-[0_10px_30px_-12px_rgba(47,107,255,1)] transition hover:brightness-110"
              >
                Continuar con el pedido
              </Link>
            ) : (
              <p role="status" className="mt-5 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
                Revisa los repuestos marcados antes de continuar.
              </p>
            )}
            <p className="mt-3 text-xs text-gris-tec">No cobramos nada en línea: el pago se coordina con un asesor por WhatsApp.</p>
          </aside>
        </div>
      )}
    </Contenedor>
  );
}

function Linea({ it }: { it: ItemCarrito }) {
  const { fijarCantidad, quitar } = useTienda();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hacer = async (f: () => Promise<void>) => {
    setOcupado(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };
  const maximo = it.disponibles ?? 99;
  return (
    <li className={cx('vidrio rounded-3xl p-4 sm:p-5', it.problema && 'border-amber-300/30')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <InsigniaTipo tipo={it.tipo} marca={it.marca} />
            {it.es_demo && <InsigniaDemo />}
          </div>
          <Link to={`/producto/${it.slug}`} className="font-display font-semibold text-white hover:text-electrico-300">
            {it.nombre}
          </Link>
          <p className="text-xs text-gris-tec">Ref. {it.sku}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-semibold text-white">{it.subtotal ? cop(it.subtotal) : 'Precio por confirmar'}</p>
          {it.precio_unitario && (
            <p className="text-xs text-gris-tec">
              {cop(it.precio_unitario)} c/u
              {it.promocion && <s className="ml-1">{cop(it.promocion.precio_antes)}</s>}
            </p>
          )}
          {it.promocion && <p className="text-[11px] font-semibold text-cian-300">{it.promocion.nombre}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center rounded-xl border border-white/10 bg-noche-900/80">
          <button
            type="button"
            aria-label={`Quitar una unidad de ${it.nombre}`}
            disabled={ocupado || it.cantidad <= 1}
            onClick={() => hacer(() => fijarCantidad(it.producto_id, it.cantidad - 1))}
            className="h-10 w-10 text-lg text-slate-200 disabled:opacity-40"
          >
            −
          </button>
          <span aria-live="polite" className="w-10 text-center text-white">
            {it.cantidad}
          </span>
          <button
            type="button"
            aria-label={`Agregar una unidad de ${it.nombre}`}
            disabled={ocupado || it.cantidad >= maximo}
            onClick={() => hacer(() => fijarCantidad(it.producto_id, it.cantidad + 1))}
            className="h-10 w-10 text-lg text-slate-200 disabled:opacity-40"
          >
            +
          </button>
        </div>
        <Boton variante="fantasma" disabled={ocupado} onClick={() => hacer(() => quitar(it.producto_id))} className="text-sm">
          Quitar
        </Boton>
      </div>
      {it.problema && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {PROBLEMA[it.problema]}
          {it.problema === 'stock_insuficiente' && it.disponibles !== null ? ` Disponibles: ${it.disponibles}.` : ''}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
    </li>
  );
}
