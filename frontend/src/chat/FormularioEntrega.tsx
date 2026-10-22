import { useState, type FormEvent } from 'react';
import { Boton, Campo, Selector } from '../componentes/ui';

/** Formulario de datos de entrega dentro del chat (el backend vuelve a validar todo). */
export function FormularioEntrega({ valores, onEnviar }: { valores: Record<string, string>; onEnviar: (d: Record<string, string>) => void }) {
  const [d, setD] = useState<Record<string, string>>({ modalidad: 'recogida_tienda', metodo_pago: '', ...valores });
  const set = (k: string) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const datos = { ...d };
    if (datos.modalidad !== 'envio') delete datos.direccion;
    onEnviar(datos);
  };
  return (
    <form onSubmit={enviar} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
      <Campo etiqueta="Nombre" value={d.nombre ?? ''} onChange={set('nombre')} required autoComplete="name" />
      <Campo etiqueta="Celular" value={d.telefono ?? ''} onChange={set('telefono')} required inputMode="tel" autoComplete="tel" placeholder="3001234567" />
      <Campo etiqueta="Ciudad" value={d.ciudad ?? ''} onChange={set('ciudad')} required autoComplete="address-level2" />
      <Selector etiqueta="Entrega" value={d.modalidad} onChange={set('modalidad')}>
        <option value="recogida_tienda">Recojo en tienda</option>
        <option value="envio">Envío (costo por confirmar)</option>
      </Selector>
      {d.modalidad === 'envio' && (
        <div className="sm:col-span-2">
          <Campo etiqueta="Dirección completa" value={d.direccion ?? ''} onChange={set('direccion')} required autoComplete="street-address" placeholder="Calle 10 # 20-30, barrio Centro" />
        </div>
      )}
      <Selector etiqueta="Medio de pago" value={d.metodo_pago} onChange={set('metodo_pago')} required ayuda="Sujeto a confirmación del negocio. No pedimos datos de tarjeta.">
        <option value="" disabled>
          Elige uno
        </option>
        <option value="nequi">Nequi</option>
        <option value="daviplata">Daviplata</option>
        <option value="transferencia">Transferencia</option>
        <option value="efectivo">Efectivo</option>
        <option value="contraentrega">Contraentrega</option>
      </Selector>
      <div className="flex items-end sm:justify-end">
        <Boton type="submit">Revisar pedido</Boton>
      </div>
    </form>
  );
}
