import { useState } from 'react';
import { apiAdmin, qs } from '../../api/cliente';
import { fecha } from '../../api/formato';
import { Alerta, Boton, Cargando, Insignia, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Evento {
  id: number;
  nivel: string;
  tipo: string;
  mensaje: string;
  datos: Record<string, unknown>;
  created_at: string;
}

export default function Eventos() {
  const [nivel, setNivel] = useState('');
  const [pagina, setPagina] = useState(1);
  const lista = useCarga(() => apiAdmin<{ items: Evento[]; tamano: number }>(`/admin/eventos${qs({ nivel, pagina, tamano: 50 })}`), [nivel, pagina]);
  return (
    <>
      <Titulo>Registro de eventos</Titulo>
      <Tarjeta>
        <div className="mb-4 max-w-xs">
          <Selector
            etiqueta="Nivel"
            value={nivel}
            onChange={(e) => {
              setPagina(1);
              setNivel(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="error">Errores</option>
            <option value="aviso">Avisos</option>
            <option value="info">Información</option>
          </Selector>
        </div>
        {lista.error && <Alerta>{lista.error}</Alerta>}
        {!lista.datos ? (
          <Cargando />
        ) : (
          <>
            <Tabla amplia columnas={['Fecha', 'Nivel', 'Tipo', 'Mensaje', 'Datos']} vacio={!lista.datos.items.length}>
              {lista.datos.items.map((e) => (
                <tr key={e.id}>
                  <td className="px-2 py-2 whitespace-nowrap">{fecha(e.created_at)}</td>
                  <td className="px-2 py-2">
                    <Insignia valor={e.nivel} />
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{e.tipo}</td>
                  <td className="px-2 py-2">{e.mensaje}</td>
                  <td className="max-w-xs truncate px-2 py-2 font-mono text-xs text-slate-500" title={JSON.stringify(e.datos)}>
                    {JSON.stringify(e.datos)}
                  </td>
                </tr>
              ))}
            </Tabla>
            <div className="flex justify-end gap-2 pt-3">
              <Boton variante="secundario" tamano="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </Boton>
              <Boton variante="secundario" tamano="sm" disabled={lista.datos.items.length < lista.datos.tamano} onClick={() => setPagina(pagina + 1)}>
                Siguiente
              </Boton>
            </div>
          </>
        )}
      </Tarjeta>
    </>
  );
}
