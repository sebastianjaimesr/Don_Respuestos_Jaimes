import { useState, type FormEvent } from 'react';
import { apiAdmin } from '../../api/cliente';
import { Alerta, AreaTexto, Boton, Campo, erroresPorCampo, mensajeError, Selector, useCarga } from '../../componentes/ui';

export interface Producto {
  id: number;
  referencia: string;
  nombre: string;
  descripcion: string | null;
  categoria: string;
  posicion: 'delantero' | 'trasero' | null;
  marca_id: number;
  tipo: 'original' | 'generico';
  precio: string | null;
  activo: boolean;
  es_demo: boolean;
  stock_minimo?: number;
  ubicacion?: string | null;
  tiempo_abastecimiento_dias?: number | null;
}
interface Marca {
  id: number;
  nombre: string;
  tipo: 'original' | 'generico';
}
interface Categoria {
  clave: string;
  etiqueta: string;
  requierePosicion: boolean;
}

/** Formulario de creación/edición. El tipo (original/genérico) lo determina la marca. */
export function FormProducto({ producto, onGuardado }: { producto?: Producto; onGuardado: (p: Producto) => void }) {
  const marcas = useCarga(() => apiAdmin<Marca[]>('/admin/marcas'), []);
  const cats = useCarga(() => apiAdmin<Categoria[]>('/admin/categorias'), []);
  const [f, setF] = useState({
    referencia: producto?.referencia ?? '',
    nombre: producto?.nombre ?? '',
    descripcion: producto?.descripcion ?? '',
    categoria: producto?.categoria ?? '',
    posicion: producto?.posicion ?? '',
    marca_id: producto ? String(producto.marca_id) : '',
    precio: producto?.precio ? String(Number(producto.precio)) : '',
    activo: producto?.activo ?? true,
    stock_minimo: String(producto?.stock_minimo ?? 2),
    ubicacion: producto?.ubicacion ?? '',
    tiempo_abastecimiento_dias: producto?.tiempo_abastecimiento_dias ? String(producto.tiempo_abastecimiento_dias) : '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const cat = cats.datos?.find((c) => c.clave === f.categoria);
  const marca = marcas.datos?.find((m) => String(m.id) === f.marca_id);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    const cuerpo = {
      referencia: f.referencia,
      nombre: f.nombre,
      descripcion: f.descripcion || null,
      categoria: f.categoria,
      posicion: cat?.requierePosicion ? f.posicion || null : null,
      marca_id: Number(f.marca_id),
      precio: f.precio === '' ? null : Number(f.precio),
      activo: f.activo,
      stock_minimo: Number(f.stock_minimo),
      ubicacion: f.ubicacion || null,
      tiempo_abastecimiento_dias: f.tiempo_abastecimiento_dias ? Number(f.tiempo_abastecimiento_dias) : null,
    };
    try {
      const p = producto ? await apiAdmin<Producto>(`/admin/productos/${producto.id}`, 'PUT', cuerpo) : await apiAdmin<Producto>('/admin/productos', 'POST', cuerpo);
      onGuardado(p);
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-2">
      {error && (
        <div className="sm:col-span-2">
          <Alerta>{error}</Alerta>
        </div>
      )}
      <Campo etiqueta="Referencia / código" value={f.referencia} onChange={set('referencia')} required error={errores.referencia} ayuda="Se guarda en mayúsculas. No puede repetirse." />
      <Campo etiqueta="Nombre" value={f.nombre} onChange={set('nombre')} required error={errores.nombre} />
      <Selector etiqueta="Categoría" value={f.categoria} onChange={set('categoria')} required error={errores.categoria}>
        <option value="" disabled>
          Elige una
        </option>
        {cats.datos?.map((c) => (
          <option key={c.clave} value={c.clave}>
            {c.etiqueta}
          </option>
        ))}
      </Selector>
      {cat?.requierePosicion ? (
        <Selector etiqueta="Posición" value={f.posicion} onChange={set('posicion')} required>
          <option value="" disabled>
            Elige una
          </option>
          <option value="delantero">Delantero</option>
          <option value="trasero">Trasero</option>
        </Selector>
      ) : (
        <div />
      )}
      <Selector etiqueta="Marca" value={f.marca_id} onChange={set('marca_id')} required error={errores.marca_id} ayuda={marca ? `Se clasificará como ${marca.tipo === 'original' ? 'ORIGINAL' : 'GENÉRICO'}` : 'La marca define si es original o genérico'}>
        <option value="" disabled>
          Elige una
        </option>
        {marcas.datos?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nombre} ({m.tipo === 'original' ? 'original' : 'genérico'})
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Precio (COP)"
        type="number"
        min="1"
        step="0.01"
        value={f.precio}
        onChange={set('precio')}
        error={errores.precio}
        ayuda="Déjalo vacío si aún no está confirmado: el asistente no lo venderá."
      />
      <Campo etiqueta="Stock mínimo (alerta)" type="number" min="0" value={f.stock_minimo} onChange={set('stock_minimo')} required />
      <Campo etiqueta="Ubicación en bodega" value={f.ubicacion} onChange={set('ubicacion')} />
      <Campo etiqueta="Tiempo de abastecimiento (días)" type="number" min="1" value={f.tiempo_abastecimiento_dias} onChange={set('tiempo_abastecimiento_dias')} ayuda="Solo si está confirmado con el proveedor." />
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={f.activo} onChange={(e) => setF((x) => ({ ...x, activo: e.target.checked }))} className="h-4 w-4" />
        Producto activo (visible para el asistente)
      </label>
      <div className="sm:col-span-2">
        <AreaTexto etiqueta="Descripción" value={f.descripcion} onChange={set('descripcion')} ayuda="Diferencias documentadas frente a otras opciones (material, garantía…)." />
      </div>
      {!producto && <p className="text-xs text-slate-500 sm:col-span-2">El producto se crea con stock 0. Luego registra una entrada de inventario.</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Boton type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </form>
  );
}
