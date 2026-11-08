import { Link, Navigate, useNavigate } from 'react-router';
import { cop, etiqueta, fecha } from '../../api/formato';
import { tienda } from '../../api/tienda';
import { useDatos, useTienda } from '../estado';
import { Boton, Contenedor, EstadoError, Esqueleto, TextoDisponibilidad } from '../ui';

/** Cuenta del cliente: datos, pedidos y favoritos. */
export default function PaginaCuenta() {
  const { cliente, verificandoSesion, salir, favoritos: idsFavoritos } = useTienda();
  const navegar = useNavigate();
  const pedidos = useDatos(() => (cliente ? tienda.misPedidos() : Promise.resolve([])), [cliente?.id]);
  const favoritos = useDatos(() => (cliente ? tienda.favoritos() : Promise.resolve([])), [cliente?.id, idsFavoritos.size]);

  if (verificandoSesion) return <Contenedor className="py-16 text-center text-gris-tec">Cargando…</Contenedor>;
  if (!cliente) return <Navigate to="/ingresar" replace />;

  return (
    <Contenedor className="py-8 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">Hola, {cliente.nombre.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-gris-tec">{cliente.email}</p>
        </div>
        <Boton
          variante="secundario"
          onClick={async () => {
            await salir();
            navegar('/', { replace: true });
          }}
        >
          Cerrar sesión
        </Boton>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="t-pedidos" className="vidrio rounded-3xl p-5 sm:p-6">
          <h2 id="t-pedidos" className="font-display text-lg font-semibold text-white">
            Mis pedidos
          </h2>
          {pedidos.cargando ? (
            <Esqueleto className="mt-4 h-24" />
          ) : pedidos.error ? (
            <div className="mt-4">
              <EstadoError error={pedidos.error} reintentar={pedidos.reintentar} />
            </div>
          ) : pedidos.datos!.length === 0 ? (
            <p className="mt-3 text-sm text-gris-tec">Aún no tienes pedidos.</p>
          ) : (
            <ul className="mt-4 divide-y divide-white/5 text-sm">
              {pedidos.datos!.map((p) => (
                <li key={p.codigo} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-mono text-white">{p.codigo}</span>
                    <span className="block text-xs text-gris-tec">
                      {fecha(p.created_at, false)} · {p.items} {p.items === 1 ? 'repuesto' : 'repuestos'}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-white">
                      {cop(p.total)}
                      {p.modalidad_entrega === 'envio' && !p.envio_confirmado ? ' + envío' : ''}
                    </span>
                    <span className="text-xs text-gris-tec">
                      {etiqueta(p.estado)} · pago {etiqueta(p.estado_pago).toLowerCase()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="t-favoritos" className="vidrio rounded-3xl p-5 sm:p-6">
          <h2 id="t-favoritos" className="font-display text-lg font-semibold text-white">
            Favoritos
          </h2>
          {favoritos.cargando ? (
            <Esqueleto className="mt-4 h-24" />
          ) : favoritos.error ? (
            <div className="mt-4">
              <EstadoError error={favoritos.error} reintentar={favoritos.reintentar} />
            </div>
          ) : favoritos.datos!.length === 0 ? (
            <p className="mt-3 text-sm text-gris-tec">
              Guarda repuestos desde su ficha para encontrarlos rápido.{' '}
              <Link to="/catalogo" className="text-electrico-300 hover:text-white">
                Ir al catálogo
              </Link>
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-white/5 text-sm">
              {favoritos.datos!.map((f) => (
                <li key={f.producto_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link to={`/producto/${f.slug}`} className="min-w-0 flex-1 text-white hover:text-electrico-300">
                    {f.nombre}
                    <span className="block text-xs text-gris-tec">Ref. {f.sku}</span>
                  </Link>
                  <span className="text-right">
                    <span className="block text-white">{f.precio ? cop(f.precio) : 'Precio por confirmar'}</span>
                    <TextoDisponibilidad estado={f.disponibilidad} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="mt-6 text-sm">
        <Link to="/pedido" className="text-electrico-300 hover:text-white">
          Consultar un pedido con su código
        </Link>
      </p>
    </Contenedor>
  );
}
