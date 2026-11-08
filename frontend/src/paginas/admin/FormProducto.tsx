import { useState, type FormEvent } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { Alerta, AreaTexto, Boton, Campo, erroresPorCampo, mensajeError, Selector, useCarga } from '../../componentes/ui';

/** Producto tal como lo devuelve GET /admin/productos/:id */
export interface Producto {
  id: number;
  sku: string;
  /** Número de parte del fabricante */
  referencia: string | null;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string;
  categoria_nombre?: string;
  posicion: 'delantero' | 'trasero' | null;
  marca_id: number;
  tipo: 'original' | 'generico' | 'alternativo';
  precio: string | null;
  precio_compra: string | null;
  especificaciones: Record<string, string | number | boolean>;
  destacado: boolean;
  proveedor_id: number | null;
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
  fabricante_moto: string | null;
  activo: boolean;
}
interface Categoria {
  clave: string;
  etiqueta: string;
  requierePosicion: boolean;
  grupo: string;
}

const aTextoSpecs = (o: Record<string, unknown> | undefined) =>
  Object.entries(o ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
/** "Material: acero" por línea → objeto. Números y sí/no se guardan con su tipo. */
function deTextoSpecs(t: string): Record<string, string | number | boolean> {
  const o: Record<string, string | number | boolean> = {};
  for (const linea of t.split('\n')) {
    const i = linea.indexOf(':');
    if (i < 1) continue;
    const k = linea.slice(0, i).trim().slice(0, 60);
    const v = linea.slice(i + 1).trim();
    if (!k || !v) continue;
    o[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : /^(sí|si)$/i.test(v) ? true : /^no$/i.test(v) ? false : v.slice(0, 200);
  }
  return o;
}

/** Crear o editar un producto. El tipo original lo define la marca (la del fabricante de la moto). */
export function FormProducto({ producto, onGuardado }: { producto?: Producto; onGuardado: (p: Producto) => void }) {
  const { tiene } = useAuth();
  const puedePrecios = tiene('precios.editar');
  const marcas = useCarga(() => apiAdmin<Marca[]>('/admin/marcas'), []);
  const cats = useCarga(() => apiAdmin<Categoria[]>('/admin/categorias'), []);
  const provs = useCarga(() => apiAdmin<{ id: number; nombre: string; activo: boolean }[]>('/admin/proveedores'), []);
  const [f, setF] = useState({
    sku: producto?.sku ?? '',
    referencia: producto?.referencia ?? '',
    codigo_barras: producto?.codigo_barras ?? '',
    nombre: producto?.nombre ?? '',
    descripcion: producto?.descripcion ?? '',
    categoria: producto?.categoria ?? '',
    posicion: producto?.posicion ?? '',
    marca_id: producto ? String(producto.marca_id) : '',
    tipo: producto?.tipo === 'alternativo' ? 'alternativo' : 'generico',
    precio: producto?.precio ? String(Number(producto.precio)) : '',
    precio_compra: producto?.precio_compra ? String(Number(producto.precio_compra)) : '',
    proveedor_id: producto?.proveedor_id ? String(producto.proveedor_id) : '',
    especificaciones: aTextoSpecs(producto?.especificaciones),
    destacado: producto?.destacado ?? false,
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
  const esOriginal = marca?.tipo === 'original';
  const grupos = [...new Set((cats.datos ?? []).map((c) => c.grupo))];

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    const cuerpo: Record<string, unknown> = {
      referencia: f.sku,
      referencia_fabricante: f.referencia.trim() || null,
      codigo_barras: f.codigo_barras.trim() || null,
      nombre: f.nombre,
      descripcion: f.descripcion || null,
      categoria: f.categoria,
      posicion: cat?.requierePosicion ? f.posicion || null : null,
      marca_id: Number(f.marca_id) || undefined,
      tipo: esOriginal ? undefined : f.tipo,
      precio: f.precio === '' ? null : Number(f.precio),
      proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null,
      especificaciones: deTextoSpecs(f.especificaciones),
      destacado: f.destacado,
      activo: f.activo,
      stock_minimo: Number(f.stock_minimo),
      ubicacion: f.ubicacion || null,
      tiempo_abastecimiento_dias: f.tiempo_abastecimiento_dias ? Number(f.tiempo_abastecimiento_dias) : null,
    };
    // Sin permiso de precios, el costo no se envía (el servidor lo conserva)
    if (puedePrecios) cuerpo.precio_compra = f.precio_compra === '' ? null : Number(f.precio_compra);
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

  const seccion = (t: string) => <h3 className="pt-2 text-xs font-semibold tracking-[0.14em] text-gris-tec uppercase sm:col-span-2">{t}</h3>;
  return (
    <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <Alerta>{error}</Alerta>
        </div>
      )}
      {seccion('Identificación')}
      <Campo etiqueta="SKU (código interno)" value={f.sku} onChange={set('sku')} required error={errores.referencia} ayuda="Se guarda en mayúsculas. No puede repetirse." />
      <Campo etiqueta="Nombre" value={f.nombre} onChange={set('nombre')} required error={errores.nombre} />
      <Campo etiqueta="Referencia del fabricante (opcional)" value={f.referencia} onChange={set('referencia')} error={errores.referencia_fabricante} ayuda="Número de parte impreso en la caja o el catálogo" />
      <Campo etiqueta="Código de barras (opcional)" value={f.codigo_barras} onChange={set('codigo_barras')} error={errores.codigo_barras} />

      {seccion('Clasificación')}
      <Selector etiqueta="Categoría" value={f.categoria} onChange={set('categoria')} required error={errores.categoria}>
        <option value="">Elige una</option>
        {grupos.map((g) => (
          <optgroup key={g} label={g}>
            {cats.datos
              ?.filter((c) => c.grupo === g)
              .map((c) => (
                <option key={c.clave} value={c.clave}>
                  {c.etiqueta}
                </option>
              ))}
          </optgroup>
        ))}
      </Selector>
      {cat?.requierePosicion ? (
        <Selector etiqueta="Posición" value={f.posicion} onChange={set('posicion')} required error={errores.posicion}>
          <option value="">Elige una</option>
          <option value="delantero">Delantero</option>
          <option value="trasero">Trasero</option>
        </Selector>
      ) : (
        <div className="hidden sm:block" />
      )}
      <Selector
        etiqueta="Marca del repuesto"
        value={f.marca_id}
        onChange={set('marca_id')}
        required
        error={errores.marca_id}
        ayuda={marca ? (esOriginal ? `Se clasifica como ORIGINAL ${marca.fabricante_moto ?? ''}` : 'Marca no original: elige si es genérico o alternativo') : 'La marca define si es original'}
      >
        <option value="">Elige una</option>
        {marcas.datos
          ?.filter((m) => m.activo || String(m.id) === f.marca_id)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre} {m.tipo === 'original' ? '(original)' : ''}
            </option>
          ))}
      </Selector>
      {marca && !esOriginal ? (
        <Selector etiqueta="Tipo" value={f.tipo} onChange={set('tipo')} ayuda="Alternativo: de calidad equivalente a la original (OEM / homologado). Genérico: de reemplazo.">
          <option value="generico">Genérico</option>
          <option value="alternativo">Alternativo</option>
        </Selector>
      ) : (
        <div className="hidden sm:block" />
      )}

      {seccion('Precios')}
      <Campo
        etiqueta="Precio de venta (COP)"
        type="number"
        min="1"
        step="0.01"
        value={f.precio}
        onChange={set('precio')}
        error={errores.precio}
        disabled={!puedePrecios && !!producto}
        ayuda={!puedePrecios && producto ? 'No tienes permiso para cambiar precios' : 'Vacío = sin precio confirmado: no se puede comprar en la tienda'}
      />
      {puedePrecios ? (
        <Campo etiqueta="Precio de compra (COP, opcional)" type="number" min="0" step="0.01" value={f.precio_compra} onChange={set('precio_compra')} error={errores.precio_compra} ayuda="Solo visible en el panel. Sirve para el valor del inventario a costo." />
      ) : (
        <div className="hidden sm:block" />
      )}
      <Selector etiqueta="Proveedor habitual (opcional)" value={f.proveedor_id} onChange={set('proveedor_id')}>
        <option value="">—</option>
        {provs.datos
          ?.filter((p) => p.activo || String(p.id) === f.proveedor_id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
      </Selector>
      <div className="hidden sm:block" />

      {seccion('Inventario')}
      <Campo etiqueta="Stock mínimo (alerta)" type="number" min="0" value={f.stock_minimo} onChange={set('stock_minimo')} required error={errores.stock_minimo} />
      <Campo etiqueta="Ubicación en bodega (opcional)" value={f.ubicacion} onChange={set('ubicacion')} placeholder="Ej.: Estante B3" />
      <Campo etiqueta="Tiempo de abastecimiento en días (opcional)" type="number" min="1" value={f.tiempo_abastecimiento_dias} onChange={set('tiempo_abastecimiento_dias')} ayuda="Solo si está confirmado con el proveedor" />
      <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF((x) => ({ ...x, activo: e.target.checked }))} className="h-4 w-4 accent-electrico-500" />
          Activo (visible en la tienda y para el asistente)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.destacado} onChange={(e) => setF((x) => ({ ...x, destacado: e.target.checked }))} className="h-4 w-4 accent-electrico-500" />
          Destacado en la portada
        </label>
      </div>

      {seccion('Descripción y ficha técnica')}
      <div className="sm:col-span-2">
        <AreaTexto etiqueta="Descripción (opcional)" value={f.descripcion} onChange={set('descripcion')} ayuda="Diferencias documentadas frente a otras opciones (material, garantía…). No inventes datos." />
      </div>
      <div className="sm:col-span-2">
        <AreaTexto
          etiqueta="Especificaciones (opcional)"
          rows={4}
          value={f.especificaciones}
          onChange={set('especificaciones')}
          error={errores.especificaciones}
          placeholder={'Una por línea, con dos puntos:\nMaterial: acero\nDiámetro (mm): 220'}
        />
      </div>
      {!producto && <p className="text-xs text-gris-tec sm:col-span-2">El producto se crea con stock 0. Luego registra una entrada o recibe una compra.</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Boton type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </form>
  );
}
