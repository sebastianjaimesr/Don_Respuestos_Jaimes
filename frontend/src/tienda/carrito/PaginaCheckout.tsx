import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { cop } from '../../api/formato';
import { tienda, type CotizacionEnvio } from '../../api/tienda';
import { useOpcionesPago } from './PagoEnLinea';
import { useTienda } from '../estado';
import { AreaTexto, Boton, Campo, Contenedor, Selector, erroresPorCampo, mensajeError } from '../ui';

const METODOS = [
  ['nequi', 'Nequi'],
  ['daviplata', 'Daviplata'],
  ['transferencia', 'Transferencia bancaria'],
  ['efectivo', 'Efectivo en tienda'],
  ['contraentrega', 'Contraentrega'],
] as const;

/** Confirmación del pedido. No se cobra nada aquí: el pedido queda con pago "pendiente". */
export default function PaginaCheckout() {
  const { carrito, cliente, olvidarCarrito, cargandoCarrito } = useTienda();
  const navegar = useNavigate();
  const [f, setF] = useState({
    nombre: cliente?.nombre ?? '',
    telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '',
    ciudad: '',
    modalidad: 'recogida_tienda' as 'recogida_tienda' | 'envio',
    ciudadEntrega: '',
    direccion: '',
    metodo: '' as string,
    notas: '',
    confirmo: false,
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const opcionesPago = useOpcionesPago();
  // Costo de envío para la ciudad de entrega: lo calcula el servidor con las tarifas que
  // configuró el negocio. Es el mismo cálculo que se aplica al registrar el pedido.
  const ciudadEnvio = (f.ciudadEntrega || f.ciudad).trim();
  const [envio, setEnvio] = useState<CotizacionEnvio | null>(null);
  useEffect(() => {
    if (f.modalidad !== 'envio' || ciudadEnvio.length < 3) {
      setEnvio(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      tienda
        .cotizarEnvio(ciudadEnvio)
        .then((r) => (vivo ? setEnvio(r) : undefined))
        .catch(() => (vivo ? setEnvio(null) : undefined));
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [f.modalidad, ciudadEnvio]);
  // Al registrar el pedido el carrito se vacía: esto evita que la página redirija al carrito en vez de a la confirmación.
  const registrado = useRef(false);
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    if (k === 'metodo') setErrores(({ metodo_pago: _, ...resto }) => resto);
  };

  if (!carrito && cargandoCarrito) return <Contenedor className="py-16 text-center text-gris-tec">Cargando…</Contenedor>;
  if (!carrito || carrito.items.length === 0) return registrado.current ? null : <Navigate to="/carrito" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErrores({});
    setError(null);
    if (!f.metodo) return setErrores({ metodo_pago: 'Elige cómo quieres pagar' });
    if (!f.confirmo) return setErrores({ confirmado_por_cliente: 'Debes confirmar el pedido' });
    setEnviando(true);
    try {
      const r = await tienda.checkout(carrito.id, {
        cliente: { nombre: f.nombre, telefono: f.telefono, ciudad: f.ciudad, email: f.email || null },
        entrega: f.modalidad === 'envio' ? { modalidad: 'envio', ciudad: f.ciudadEntrega || f.ciudad, direccion: f.direccion } : { modalidad: 'recogida_tienda' },
        metodo_pago: f.metodo,
        confirmado_por_cliente: true,
        notas: f.notas || null,
      });
      registrado.current = true;
      navegar(`/pedido/${r.pedido.codigo}`, { replace: true, state: { ...r, telefono: f.telefono } });
      olvidarCarrito();
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      setError(Object.keys(porCampo).length ? 'Revisa los campos marcados.' : mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };
  const err = (k: string) => errores[`cliente.${k}`] ?? errores[`entrega.${k}`] ?? errores[k];

  return (
    <Contenedor className="py-8 sm:py-10">
      <h1 className="mb-6 font-display text-2xl font-bold text-white sm:text-3xl">Confirmar pedido</h1>
      <form onSubmit={enviar} noValidate className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <fieldset className="vidrio space-y-4 rounded-3xl p-5 sm:p-6 [&>legend+*]:clear-both">
            <legend className="float-left mb-4 w-full font-display text-lg font-semibold text-white">Tus datos</legend>
            <Campo id="co-nombre" etiqueta="Nombre completo" autoComplete="name" required value={f.nombre} onChange={cambiar('nombre')} error={err('nombre')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="co-tel" etiqueta="Celular" type="tel" inputMode="tel" autoComplete="tel" required value={f.telefono} onChange={cambiar('telefono')} error={err('telefono')} ayuda="Te contactamos por WhatsApp a este número." />
              <Campo id="co-ciudad" etiqueta="Ciudad" autoComplete="address-level2" required value={f.ciudad} onChange={cambiar('ciudad')} error={err('ciudad')} />
            </div>
            <Campo id="co-email" etiqueta="Correo (opcional)" type="email" autoComplete="email" value={f.email} onChange={cambiar('email')} error={err('email')} />
          </fieldset>

          <fieldset className="vidrio space-y-4 rounded-3xl p-5 sm:p-6 [&>legend+*]:clear-both">
            <legend className="float-left mb-4 w-full font-display text-lg font-semibold text-white">Entrega</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['recogida_tienda', 'Recojo en la tienda', 'Sin costo de envío'],
                  ['envio', 'Envío a domicilio', 'El costo depende de la ciudad'],
                ] as const
              ).map(([v, t, d]) => (
                <label key={v} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 p-4 has-[:checked]:border-electrico-400 has-[:checked]:bg-electrico-500/10">
                  <input type="radio" name="modalidad" value={v} checked={f.modalidad === v} onChange={() => setF((x) => ({ ...x, modalidad: v }))} className="mt-1 accent-electrico-500" />
                  <span>
                    <span className="block font-medium text-white">{t}</span>
                    <span className="text-xs text-gris-tec">{d}</span>
                  </span>
                </label>
              ))}
            </div>
            {f.modalidad === 'envio' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo id="co-ciudad-env" etiqueta="Ciudad de entrega" placeholder={f.ciudad || 'Ciudad'} value={f.ciudadEntrega} onChange={cambiar('ciudadEntrega')} error={errores['entrega.ciudad']} />
                <Campo id="co-dir" etiqueta="Dirección" autoComplete="street-address" required value={f.direccion} onChange={cambiar('direccion')} error={err('direccion')} />
                {envio && (
                  <p aria-live="polite" className="text-sm sm:col-span-2">
                    {envio.costo !== null ? (
                      <span className="text-slate-200">
                        Envío a {envio.ciudad}: <strong className="text-white">{envio.costo === 0 ? 'gratis' : cop(envio.costo)}</strong>
                        {envio.dias_estimados !== null && <span className="text-gris-tec"> · llega en unos {envio.dias_estimados} días hábiles</span>}
                      </span>
                    ) : (
                      <span className="text-gris-tec">Aún no tenemos tarifa para {envio.ciudad}: un asesor te confirma el costo del envío antes de cobrarte.</span>
                    )}
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="vidrio space-y-4 rounded-3xl p-5 sm:p-6 [&>legend+*]:clear-both">
            <legend className="float-left mb-4 w-full font-display text-lg font-semibold text-white">Pago</legend>
            <Selector id="co-pago" etiqueta="¿Cómo quieres pagar?" value={f.metodo} onChange={cambiar('metodo')} error={errores.metodo_pago}>
              <option value="">Elige una opción</option>
              {opcionesPago?.en_linea && <option value="en_linea">Pago en línea (tarjeta, PSE, Nequi…)</option>}
              {METODOS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </Selector>
            <p className="rounded-xl bg-electrico-500/10 p-3 text-sm text-electrico-300">
              {f.metodo === 'en_linea'
                ? 'Al registrar el pedido te mostramos el botón para pagar en Wompi. El pago queda confirmado cuando Wompi nos avisa, no antes.'
                : 'Aquí no se hace ningún cobro. Un asesor te confirma el total y los datos de pago por WhatsApp. El pedido queda con pago pendiente hasta que lo recibamos.'}
            </p>
            <AreaTexto id="co-notas" etiqueta="Notas (opcional)" rows={3} maxLength={500} value={f.notas} onChange={cambiar('notas')} placeholder="Ej.: modelo y año exacto de tu moto" />
          </fieldset>
        </div>

        <aside className="vidrio h-fit space-y-4 rounded-3xl p-5 lg:sticky lg:top-24">
          <h2 className="font-display text-lg font-semibold text-white">Tu pedido</h2>
          <ul className="space-y-2 text-sm">
            {carrito.items.map((it) => (
              <li key={it.producto_id} className="flex justify-between gap-3">
                <span className="text-slate-300">
                  {it.nombre} <span className="text-gris-tec">×{it.cantidad}</span>
                </span>
                <span className="shrink-0 text-white">{it.subtotal ? cop(it.subtotal) : '—'}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-white/10 pt-3 text-sm">
            <span className="text-gris-tec">Subtotal</span>
            <span className="font-semibold text-white">{cop(carrito.subtotal)}</span>
          </div>
          {f.modalidad === 'envio' &&
            (envio?.costo != null ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gris-tec">Envío</span>
                  <span className="text-white">{envio.costo === 0 ? 'Gratis' : cop(envio.costo)}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-3 text-sm">
                  <span className="text-gris-tec">Total</span>
                  <span className="font-semibold text-white">{cop(Number(carrito.subtotal) + envio.costo)}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-gris-tec">Más el envío, que te confirma un asesor.</p>
            ))}
          <label className="flex items-start gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={f.confirmo} onChange={(e) => {
              const v = e.target.checked;
              setF((x) => ({ ...x, confirmo: v }));
              if (v) setErrores(({ confirmado_por_cliente: _, ...resto }) => resto);
            }} className="mt-1 h-4 w-4 accent-electrico-500" />
            <span>Revisé los repuestos y quiero registrar este pedido.</span>
          </label>
          {errores.confirmado_por_cliente && <p className="text-xs text-rose-300">{errores.confirmado_por_cliente}</p>}
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <Boton type="submit" cargando={enviando} disabled={!carrito.listo_para_pedido} className="w-full py-3">
            Registrar pedido
          </Boton>
          {!carrito.listo_para_pedido && (
            <p className="text-xs text-amber-200">
              Hay repuestos con problemas. <Link to="/carrito" className="underline">Revisa el carrito</Link>.
            </p>
          )}
        </aside>
      </form>
    </Contenedor>
  );
}
