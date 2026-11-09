import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { cop } from '../../api/formato';
import { EditorModal, EstadoActivo, type DefCampo } from '../../componentes/editor';
import { Alerta, Boton, Cargando, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Tarifa {
  id: number;
  ciudad: string;
  departamento: string | null;
  costo: string;
  dias_estimados: number | null;
  activo: boolean;
}

const CAMPOS: DefCampo[] = [
  { k: 'ciudad', etiqueta: 'Ciudad', requerido: true },
  { k: 'departamento', etiqueta: 'Departamento' },
  { k: 'costo', etiqueta: 'Costo del envío (COP)', tipo: 'dinero', requerido: true, ayuda: 'Valor confirmado con la transportadora' },
  { k: 'dias_estimados', etiqueta: 'Días hábiles estimados', tipo: 'numero' },
  { k: 'activo', etiqueta: 'Activa', tipo: 'bool' },
];

export default function Envios() {
  const { tiene } = useAuth();
  const editar = tiene('configuracion.editar');
  const lista = useCarga(() => apiAdmin<Tarifa[]>('/admin/envios/tarifas'), []);
  const [editor, setEditor] = useState<Record<string, unknown> | null | undefined>(undefined);
  if (lista.error) return <Alerta>{lista.error}</Alerta>;
  if (!lista.datos) return <Cargando />;
  const guardar = async (c: Record<string, unknown>) => {
    const id = editor?.id as number | undefined;
    await apiAdmin(id ? `/admin/envios/tarifas/${id}` : '/admin/envios/tarifas', id ? 'PUT' : 'POST', c);
    await lista.recargar();
  };
  return (
    <>
      <Titulo descripcion="Costo de envío por ciudad. Registra solo valores confirmados con la transportadora." acciones={editar && <Boton onClick={() => setEditor(null)}>Nueva tarifa</Boton>}>
        Tarifas de envío
      </Titulo>
      <div className="mb-4">
        <Alerta tipo="info">La tienda, el asistente y las cotizaciones cobran el envío con estas tarifas según la ciudad de entrega (sin importar tildes). Si una ciudad no está aquí, se usa el costo general de Configuración si está confirmado; si no, el envío queda "por confirmar" y un asesor lo define.</Alerta>
      </div>
      <Tarjeta>
        <Tabla columnas={['Ciudad', 'Departamento', 'Costo', 'Días', 'Estado', '']} vacio={!lista.datos.length}>
          {lista.datos.map((t) => (
            <tr key={t.id}>
              <td className="px-2 py-2 font-medium text-white">{t.ciudad}</td>
              <td className="px-2 py-2">{t.departamento ?? '—'}</td>
              <td className="px-2 py-2 tabular-nums">{cop(t.costo)}</td>
              <td className="px-2 py-2 tabular-nums">{t.dias_estimados ?? '—'}</td>
              <td className="px-2 py-2">
                <EstadoActivo activo={t.activo} />
              </td>
              <td className="px-2 py-2 text-right">
                {editar && (
                  <Boton tamano="sm" variante="fantasma" onClick={() => setEditor(t as unknown as Record<string, unknown>)}>
                    Editar
                  </Boton>
                )}
              </td>
            </tr>
          ))}
        </Tabla>
      </Tarjeta>
      {editor !== undefined && <EditorModal abierto titulo={editor?.id ? 'Editar tarifa' : 'Nueva tarifa'} campos={CAMPOS} fila={editor} onCerrar={() => setEditor(undefined)} guardar={guardar} />}
    </>
  );
}
