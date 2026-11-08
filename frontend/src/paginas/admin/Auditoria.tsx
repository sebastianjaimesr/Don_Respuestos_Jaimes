import { useState } from 'react';
import { apiAdmin, qs } from '../../api/cliente';
import { fecha } from '../../api/formato';
import { Alerta, Boton, Cargando, Insignia, Selector, Campo, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Registro {
  id: number;
  tabla: string;
  registro_id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  cambios: Record<string, unknown>;
  created_at: string;
  asesor: string | null;
}

const TABLAS: Record<string, string> = {
  productos: 'Productos',
  inventario: 'Inventario',
  compatibilidades: 'Compatibilidades',
  categorias: 'Categorías',
  marcas_repuesto: 'Marcas',
  fabricantes_moto: 'Fabricantes',
  modelos_motocicleta: 'Modelos',
  versiones_moto: 'Versiones',
  proveedores: 'Proveedores',
  compras: 'Compras',
  promociones: 'Promociones',
  tarifas_envio: 'Tarifas de envío',
  pedidos: 'Pedidos',
  configuracion_negocio: 'Configuración',
  asesores: 'Usuarios',
  rol_permisos: 'Permisos',
  roles: 'Roles',
  producto_imagenes: 'Imágenes',
};
const ACCION = { INSERT: { t: 'Creó', c: 'verde' }, UPDATE: { t: 'Cambió', c: 'azul' }, DELETE: { t: 'Borró', c: 'rojo' } } as const;
const TAMANO = 40;

/** Qué cambió, quién y cuándo, en todas las tablas del negocio. */
export default function Auditoria() {
  const [f, setF] = useState({ tabla: '', registro_id: '' });
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<number | null>(null);
  const lista = useCarga(() => apiAdmin<{ items: Registro[] }>(`/admin/auditoria${qs({ ...f, pagina, tamano: TAMANO })}`), [f.tabla, f.registro_id, pagina]);

  return (
    <>
      <Titulo descripcion="Cada creación, cambio o borrado en la base de datos queda registrado con el usuario que lo hizo. No se puede editar ni borrar desde el panel.">Auditoría</Titulo>
      <Tarjeta className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Selector
            etiqueta="Qué"
            value={f.tabla}
            onChange={(e) => {
              setF((x) => ({ ...x, tabla: e.target.value }));
              setPagina(1);
            }}
          >
            <option value="">Todo</option>
            {Object.entries(TABLAS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Selector>
          <Campo
            etiqueta="ID del registro"
            value={f.registro_id}
            onChange={(e) => {
              setF((x) => ({ ...x, registro_id: e.target.value.trim() }));
              setPagina(1);
            }}
            placeholder="Ej.: 42"
          />
        </div>
      </Tarjeta>
      {lista.error && <Alerta>{lista.error}</Alerta>}
      {!lista.datos ? (
        <Cargando />
      ) : (
        <Tarjeta>
          <Tabla columnas={['Fecha', 'Usuario', 'Acción', 'Qué', 'Detalle']} vacio={!lista.datos.items.length} amplia>
            {lista.datos.items.map((r) => {
              const claves = Object.keys(r.cambios ?? {});
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-2 py-2 text-xs whitespace-nowrap">{fecha(r.created_at)}</td>
                  <td className="px-2 py-2 text-xs">{r.asesor ?? 'Sistema / tienda'}</td>
                  <td className="px-2 py-2">
                    <Insignia color={ACCION[r.accion].c} texto={ACCION[r.accion].t} />
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {TABLAS[r.tabla] ?? r.tabla} <span className="font-mono text-gris-tec">#{r.registro_id}</span>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {claves.length === 0 ? (
                      '—'
                    ) : abierto === r.id ? (
                      <pre className="max-w-xl overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(r.cambios, null, 2)}</pre>
                    ) : (
                      <button type="button" className="text-left text-electrico-300 hover:underline" onClick={() => setAbierto(r.id)}>
                        {claves.slice(0, 4).join(', ')}
                        {claves.length > 4 ? ` y ${claves.length - 4} más` : ''} — ver
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabla>
          <div className="flex justify-end gap-2 pt-3">
            <Boton variante="secundario" tamano="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
              Anterior
            </Boton>
            <Boton variante="secundario" tamano="sm" disabled={lista.datos.items.length < TAMANO} onClick={() => setPagina((p) => p + 1)}>
              Siguiente
            </Boton>
          </div>
        </Tarjeta>
      )}
    </>
  );
}
