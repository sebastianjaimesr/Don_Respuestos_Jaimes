import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../api/auth';
import { apiAdmin, qs } from '../../api/cliente';
import { cop } from '../../api/formato';
import { Alerta, Boton, Cargando, Insignia, InsigniaDemo, Modal, Paginacion, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { FormProducto } from './FormProducto';
import { Titulo } from './Layout';

interface Fila {
  id: number;
  referencia: string;
  nombre: string;
  categoria: string;
  posicion: string | null;
  tipo: string;
  precio: string | null;
  activo: boolean;
  es_demo: boolean;
  marca: string;
  cantidad: number | null;
  stock_minimo: number | null;
  estado: string;
  num_compatibilidades: number;
}

export default function Productos() {
  const { puede } = useAuth();
  const nav = useNavigate();
  const [filtros, setFiltros] = useState({ q: '', categoria: '', tipo: '', estado_stock: '', activo: '' });
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [nuevo, setNuevo] = useState(false);
  const cats = useCarga(() => apiAdmin<{ clave: string; etiqueta: string }[]>('/admin/categorias'), []);
  const lista = useCarga(
    () => apiAdmin<{ items: Fila[]; total: number; pagina: number; tamano: number }>(`/admin/productos${qs({ ...filtros, pagina, tamano: 20 })}`),
    [JSON.stringify(filtros), pagina],
  );
  const setF = (k: keyof typeof filtros) => (e: { target: { value: string } }) => {
    setPagina(1);
    setFiltros((f) => ({ ...f, [k]: e.target.value }));
  };

  return (
    <>
      <Titulo acciones={puede('admin') && <Boton onClick={() => setNuevo(true)}>Nuevo producto</Boton>}>Productos</Titulo>
      <Tarjeta>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            setPagina(1);
            setFiltros((f) => ({ ...f, q: busqueda }));
          }}
        >
          <div className="flex items-end gap-2 lg:col-span-2">
            <div className="flex-1">
              <label htmlFor="buscar" className="text-sm font-medium text-slate-700">
                Buscar
              </label>
              <input id="buscar" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o referencia" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <Boton type="submit" variante="secundario">
              Buscar
            </Boton>
          </div>
          <Selector etiqueta="Categoría" value={filtros.categoria} onChange={setF('categoria')}>
            <option value="">Todas</option>
            {cats.datos?.map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.etiqueta}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="Tipo" value={filtros.tipo} onChange={setF('tipo')}>
            <option value="">Todos</option>
            <option value="original">Original</option>
            <option value="generico">Genérico</option>
          </Selector>
          <Selector etiqueta="Stock" value={filtros.estado_stock} onChange={setF('estado_stock')}>
            <option value="">Todos</option>
            <option value="disponible">Disponible</option>
            <option value="stock_bajo">Stock bajo</option>
            <option value="agotado">Agotado</option>
          </Selector>
        </form>
        {lista.error && <Alerta>{lista.error}</Alerta>}
        {lista.cargando && !lista.datos ? (
          <Cargando />
        ) : (
          <>
            <Tabla amplia columnas={['Referencia', 'Producto', 'Tipo', 'Precio', 'Stock', 'Compat.', 'Estado']} vacio={!lista.datos?.items.length}>
              {lista.datos?.items.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/admin/productos/${p.id}`)}>
                  <td className="px-2 py-2 font-mono text-xs">
                    <Link to={`/admin/productos/${p.id}`} className="text-marca-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {p.referencia}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.nombre}
                      {p.es_demo && <InsigniaDemo />}
                      {!p.activo && <Insignia color="gris" texto="Inactivo" />}
                    </div>
                    <span className="text-xs text-slate-500">{p.marca}</span>
                  </td>
                  <td className="px-2 py-2">
                    <Insignia valor={p.tipo} />
                  </td>
                  <td className="px-2 py-2 tabular-nums">{p.precio ? cop(p.precio) : <Insignia color="amarillo" texto="Sin precio" />}</td>
                  <td className="px-2 py-2 tabular-nums">{p.cantidad ?? '—'}</td>
                  <td className="px-2 py-2 tabular-nums">{p.num_compatibilidades || <Insignia color="rojo" texto="0" />}</td>
                  <td className="px-2 py-2">
                    <Insignia valor={p.estado} />
                  </td>
                </tr>
              ))}
            </Tabla>
            {lista.datos && <Paginacion pagina={pagina} tamano={lista.datos.tamano} total={lista.datos.total} onCambiar={setPagina} />}
          </>
        )}
      </Tarjeta>
      <Modal abierto={nuevo} titulo="Nuevo producto" onCerrar={() => setNuevo(false)}>
        <FormProducto onGuardado={(p) => nav(`/admin/productos/${p.id}`)} />
      </Modal>
    </>
  );
}
