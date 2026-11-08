import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { cop, etiqueta, fecha } from '../../api/formato';
import { tienda, type PedidoCreado } from '../../api/tienda';
import { Boton, Campo, Contenedor, mensajeError } from '../ui';
import { PagoEnLinea } from './PagoEnLinea';

type Seguimiento = Awaited<ReturnType<typeof tienda.seguimiento>>;

/**
 * /pedido/:codigo justo después del checkout (los datos llegan en el estado de navegación)
 * y /pedido para consultar un pedido con código + celular.
 */
export default function PaginaPedido() {
  const { codigo } = useParams();
  const recien = (useLocation().state as PedidoCreado | null) ?? null;
  if (recien && recien.pedido.codigo === codigo) return <Confirmacion r={recien} />;
  return <ConsultarPedido codigoInicial={codigo ?? ''} />;
}

function Confirmacion({ r }: { r: PedidoCreado }) {
  const p = r.pedido;
  const totalDefinitivo = p.modalidad_entrega !== 'envio' || p.envio_confirmado;
  return (
    <Contenedor className="max-w-3xl py-10">
      <div className="vidrio rounded-3xl p-6 text-center sm:p-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/15 text-2xl text-emerald-300" aria-hidden>
          ✓
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-white">Pedido registrado</h1>
        <p className="mt-2 text-slate-300">
          Tu código es <strong className="font-mono text-white">{p.codigo}</strong>. Guárdalo para consultar el estado.
        </p>
        <p className="mt-3 text-sm text-amber-100">El pago está pendiente: todavía no se ha cobrado nada.</p>
        {r.telefono && <PagoEnLinea codigo={p.codigo} telefono={r.telefono} estadoPago={p.estado_pago} total={p.total} totalDefinitivo={totalDefinitivo} />}
        {r.whatsapp ? (
          <a
            href={r.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 px-6 font-semibold text-white transition hover:bg-emerald-400"
          >
            Enviar el pedido por WhatsApp
          </a>
        ) : (
          <p className="mt-6 rounded-xl bg-white/[0.04] p-3 text-sm text-gris-tec">El número de WhatsApp de ventas aún no está configurado. Te contactaremos al celular que registraste.</p>
        )}
      </div>

      <section className="vidrio mt-6 rounded-3xl p-5 sm:p-6" aria-labelledby="t-detalle">
        <h2 id="t-detalle" className="font-display text-lg font-semibold text-white">
          Detalle
        </h2>
        <ul className="mt-4 divide-y divide-white/5 text-sm">
          {p.lineas.map((l) => (
            <li key={l.referencia} className="flex justify-between gap-3 py-2.5">
              <span className="text-slate-300">
                {l.descripcion} <span className="text-gris-tec">×{l.cantidad}</span>
              </span>
              <span className="text-white">{cop(l.subtotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gris-tec">Entrega</dt>
            <dd className="text-slate-200">{p.modalidad_entrega === 'envio' ? (p.envio_confirmado ? `Envío ${cop(p.costo_envio)}` : 'Envío por confirmar') : 'Recoges en la tienda'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gris-tec">Total</dt>
            <dd className="font-semibold text-white">
              {cop(p.total)}
              {p.modalidad_entrega === 'envio' && !p.envio_confirmado ? ' + envío' : ''}
            </dd>
          </div>
        </dl>
      </section>
      <p className="mt-6 text-center text-sm">
        <Link to="/catalogo" className="text-electrico-300 hover:text-white">
          Seguir comprando
        </Link>
      </p>
    </Contenedor>
  );
}

function ConsultarPedido({ codigoInicial }: { codigoInicial: string }) {
  // Wompi devuelve aquí al cliente. Eso NO confirma el pago: lo confirma el aviso firmado de Wompi.
  const volvioDePagar = useSearchParams()[0].get('pago') === 'volvio';
  const [codigo, setCodigo] = useState(codigoInicial);
  const [telefono, setTelefono] = useState('');
  const [r, setR] = useState<Seguimiento | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const consultar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setR(null);
    setCargando(true);
    try {
      setR(await tienda.seguimiento(codigo.trim(), telefono.trim()));
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  };
  return (
    <Contenedor className="max-w-xl py-10">
      <h1 className="font-display text-2xl font-bold text-white">Consultar mi pedido</h1>
      {volvioDePagar && (
        <p role="status" className="mt-3 rounded-xl bg-electrico-500/10 p-3 text-sm text-electrico-300">
          Volviste de Wompi. El pago se marca como recibido cuando Wompi nos lo confirma, normalmente en pocos minutos. Consulta el pedido para ver el estado.
        </p>
      )}
      <p className="mt-2 text-sm text-gris-tec">Escribe el código del pedido y el celular con el que lo registraste.</p>
      <form onSubmit={consultar} className="vidrio mt-6 space-y-4 rounded-3xl p-5 sm:p-6">
        <Campo id="sg-codigo" etiqueta="Código del pedido" required value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="PED-…" />
        <Campo id="sg-tel" etiqueta="Celular" type="tel" inputMode="tel" required value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        <Boton type="submit" cargando={cargando} className="w-full py-3">
          Consultar
        </Boton>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </form>
      {r && (
        <>
        <dl className="vidrio mt-6 space-y-2 rounded-3xl p-5 text-sm sm:p-6" aria-live="polite">
          {(
            [
              ['Pedido', r.codigo],
              ['Estado', etiqueta(r.estado)],
              ['Pago', etiqueta(r.estado_pago)],
              ['Entrega', etiqueta(r.modalidad_entrega)],
              ['Total', `${cop(r.total)}${r.modalidad_entrega === 'envio' && !r.envio_confirmado ? ' + envío' : ''}`],
              ['Registrado', fecha(r.created_at)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-gris-tec">{k}</dt>
              <dd className="text-right text-white">{v}</dd>
            </div>
          ))}
        </dl>
        <PagoEnLinea codigo={r.codigo} telefono={telefono.trim()} estadoPago={r.estado_pago} total={r.total} totalDefinitivo={r.modalidad_entrega !== 'envio' || r.envio_confirmado} />
        </>
      )}
    </Contenedor>
  );
}
