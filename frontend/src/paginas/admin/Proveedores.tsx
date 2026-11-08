import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { EditorModal, EstadoActivo, type DefCampo } from '../../componentes/editor';
import { Alerta, Boton, Cargando, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Proveedor {
  id: number;
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  ciudad: string | null;
  notas: string | null;
  activo: boolean;
  productos: number;
}

const CAMPOS: DefCampo[] = [
  { k: 'nombre', etiqueta: 'Nombre o razón social', requerido: true, ancho: true },
  { k: 'nit', etiqueta: 'NIT', placeholder: '900123456-7' },
  { k: 'ciudad', etiqueta: 'Ciudad' },
  { k: 'contacto', etiqueta: 'Persona de contacto' },
  { k: 'telefono', etiqueta: 'Teléfono' },
  { k: 'email', etiqueta: 'Correo', tipo: 'email', ancho: true },
  { k: 'notas', etiqueta: 'Notas', tipo: 'area' },
  { k: 'activo', etiqueta: 'Activo', tipo: 'bool' },
];

export default function Proveedores() {
  const { tiene } = useAuth();
  const editar = tiene('compras.gestionar');
  const lista = useCarga(() => apiAdmin<Proveedor[]>('/admin/proveedores'), []);
  const [editor, setEditor] = useState<Record<string, unknown> | null | undefined>(undefined);
  if (lista.error) return <Alerta>{lista.error}</Alerta>;
  if (!lista.datos) return <Cargando />;
  const guardar = async (c: Record<string, unknown>) => {
    const id = editor?.id as number | undefined;
    await apiAdmin(id ? `/admin/proveedores/${id}` : '/admin/proveedores', id ? 'PUT' : 'POST', c);
    await lista.recargar();
  };
  return (
    <>
      <Titulo
        descripcion="A quién le compras. Se usan en las compras (que suben el stock) y como filtro en precios masivos."
        acciones={editar && <Boton onClick={() => setEditor(null)}>Nuevo proveedor</Boton>}
      >
        Proveedores
      </Titulo>
      <Tarjeta>
        <Tabla columnas={['Proveedor', 'NIT', 'Contacto', 'Ciudad', 'Productos', 'Estado', '']} vacio={!lista.datos.length} amplia>
          {lista.datos.map((p) => (
            <tr key={p.id}>
              <td className="px-2 py-2 font-medium text-white">{p.nombre}</td>
              <td className="px-2 py-2 font-mono text-xs">{p.nit ?? '—'}</td>
              <td className="px-2 py-2">
                {p.contacto ?? '—'}
                {(p.telefono || p.email) && <span className="block text-xs text-gris-tec">{[p.telefono, p.email].filter(Boolean).join(' · ')}</span>}
              </td>
              <td className="px-2 py-2">{p.ciudad ?? '—'}</td>
              <td className="px-2 py-2 tabular-nums">{p.productos}</td>
              <td className="px-2 py-2">
                <EstadoActivo activo={p.activo} />
              </td>
              <td className="px-2 py-2 text-right">
                {editar && (
                  <Boton tamano="sm" variante="fantasma" onClick={() => setEditor(p as unknown as Record<string, unknown>)}>
                    Editar
                  </Boton>
                )}
              </td>
            </tr>
          ))}
        </Tabla>
      </Tarjeta>
      {editor !== undefined && <EditorModal abierto titulo={editor?.id ? 'Editar proveedor' : 'Nuevo proveedor'} campos={CAMPOS} fila={editor} onCerrar={() => setEditor(undefined)} guardar={guardar} />}
    </>
  );
}
