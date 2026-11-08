import { useState } from 'react';
import { apiAdmin } from '../../api/cliente';
import { cop } from '../../api/formato';
import { Alerta, Boton, Campo, Selector, Tabla, Tarjeta, erroresPorCampo, mensajeError, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Resultado {
  aplicado: boolean;
  total: number;
  productos: { id: number; sku: string; nombre: string; precio_actual: string; precio_nuevo: string }[];
}

/**
 * Sube o baja precios de venta de un grupo de productos. Primero muestra la vista
 * previa; nada cambia hasta confirmar. Los productos sin precio no se tocan.
 */
export default function PreciosMasivos() {
  const cats = useCarga(() => apiAdmin<{ clave: string; etiqueta: string }[]>('/admin/categorias'), []);
  const marcas = useCarga(() => apiAdmin<{ id: number; nombre: string }[]>('/admin/marcas'), []);
  const provs = useCarga(() => apiAdmin<{ id: number; nombre: string }[]>('/admin/proveedores'), []);
  const [f, setF] = useState({ categoria: '', marca_id: '', proveedor_id: '', tipo: '', modo: 'porcentaje', valor: '', redondeo: 'cien' });
  const [vista, setVista] = useState<Resultado | null>(null);
  const [hecho, setHecho] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setVista(null);
  };

  const enviar = async (aplicar: boolean) => {
    setError(null);
    setErrores({});
    setOcupado(true);
    try {
      const filtros: Record<string, unknown> = {};
      if (f.categoria) filtros.categoria = f.categoria;
      if (f.marca_id) filtros.marca_id = Number(f.marca_id);
      if (f.proveedor_id) filtros.proveedor_id = Number(f.proveedor_id);
      if (f.tipo) filtros.tipo = f.tipo;
      const r = await apiAdmin<Resultado>('/admin/precios/masivo', 'POST', { filtros, modo: f.modo, valor: Number(f.valor), redondeo: f.redondeo, aplicar });
      if (aplicar) {
        setHecho(r);
        setVista(null);
      } else {
        setVista(r);
        setHecho(null);
      }
    } catch (e) {
      setErrores(erroresPorCampo(e));
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };

  const r = vista ?? hecho;
  return (
    <>
      <Titulo descripcion="Cambia el precio de venta de un grupo de productos de una vez. Siempre ves la vista previa antes de aplicar, y cada cambio queda en el historial de precios con tu usuario.">
        Precios masivos
      </Titulo>
      <Tarjeta titulo="1. ¿A qué productos?" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Selector etiqueta="Categoría" value={f.categoria} onChange={cambiar('categoria')}>
            <option value="">Cualquiera</option>
            {cats.datos?.map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.etiqueta}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="Marca" value={f.marca_id} onChange={cambiar('marca_id')}>
            <option value="">Cualquiera</option>
            {marcas.datos?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="Proveedor" value={f.proveedor_id} onChange={cambiar('proveedor_id')}>
            <option value="">Cualquiera</option>
            {provs.datos?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="Tipo" value={f.tipo} onChange={cambiar('tipo')}>
            <option value="">Cualquiera</option>
            <option value="original">Original</option>
            <option value="generico">Genérico</option>
            <option value="alternativo">Alternativo</option>
          </Selector>
        </div>
        {errores.filtros && <p className="mt-2 text-xs text-red-300">{errores.filtros}</p>}
      </Tarjeta>
      <Tarjeta titulo="2. ¿Cuánto?" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Selector etiqueta="Cambio" value={f.modo} onChange={cambiar('modo')}>
            <option value="porcentaje">Porcentaje (%)</option>
            <option value="valor">Valor fijo (COP)</option>
          </Selector>
          <Campo
            etiqueta={f.modo === 'porcentaje' ? 'Porcentaje (negativo para bajar)' : 'Valor en COP (negativo para bajar)'}
            type="number"
            step="0.01"
            value={f.valor}
            onChange={cambiar('valor')}
            error={errores.valor}
            placeholder={f.modo === 'porcentaje' ? 'Ej.: 8 o -5' : 'Ej.: 2000'}
          />
          <Selector etiqueta="Redondear a" value={f.redondeo} onChange={cambiar('redondeo')}>
            <option value="cien">Centena ($100)</option>
            <option value="mil">Mil ($1.000)</option>
            <option value="ninguno">Sin redondeo</option>
          </Selector>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Boton variante="secundario" disabled={ocupado || !f.valor} onClick={() => enviar(false)}>
            Ver vista previa
          </Boton>
          {vista && vista.total > 0 && (
            <Boton disabled={ocupado} onClick={() => enviar(true)}>
              Aplicar a {vista.total} {vista.total === 1 ? 'producto' : 'productos'}
            </Boton>
          )}
        </div>
      </Tarjeta>
      {error && <Alerta>{error}</Alerta>}
      {hecho && <Alerta tipo="exito">Listo: se actualizaron {hecho.total} precios. Quedaron en el historial de cada producto.</Alerta>}
      {r && (
        <Tarjeta titulo={vista ? `Vista previa: ${r.total} productos (no se ha cambiado nada)` : `Aplicado a ${r.total} productos`} className="mt-4">
          <Tabla columnas={['Referencia', 'Producto', 'Precio actual', 'Precio nuevo', 'Cambio']} vacio={!r.productos.length}>
            {r.productos.map((p) => {
              const d = Number(p.precio_nuevo) - Number(p.precio_actual);
              return (
                <tr key={p.id}>
                  <td className="px-2 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-2 py-2">{p.nombre}</td>
                  <td className="px-2 py-2 tabular-nums">{cop(p.precio_actual)}</td>
                  <td className="px-2 py-2 font-semibold tabular-nums text-white">{cop(p.precio_nuevo)}</td>
                  <td className={`px-2 py-2 tabular-nums ${d >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {d >= 0 ? '+' : ''}
                    {cop(d)}
                  </td>
                </tr>
              );
            })}
          </Tabla>
          {r.total > r.productos.length && <p className="pt-2 text-xs text-gris-tec">Se muestran los primeros {r.productos.length}.</p>}
        </Tarjeta>
      )}
    </>
  );
}
