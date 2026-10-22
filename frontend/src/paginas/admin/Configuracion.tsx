import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { Alerta, Boton, Cargando, Insignia, InsigniaPendiente, mensajeError, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Item {
  clave: string;
  valor: unknown;
  descripcion: string;
  confirmado: boolean;
}

const LISTAS = ['medios_pago', 'ciudades_envio', 'transportadoras'];
const NUMEROS = ['costo_envio', 'vigencia_cotizacion_dias'];

function aTexto(clave: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function desdeTexto(clave: string, t: string): unknown {
  const s = t.trim();
  if (!s) return null;
  if (LISTAS.includes(clave)) return s.split(',').map((x) => x.trim()).filter(Boolean);
  if (NUMEROS.includes(clave)) {
    if (s.startsWith('{')) return JSON.parse(s); // tabla por ciudad: {"bogota": 12000, "default": 18000}
    const n = Number(s.replace(/[.$\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error('Debe ser un número');
    return n;
  }
  return s;
}

export default function Configuracion() {
  const { puede } = useAuth();
  const cfg = useCarga(() => apiAdmin<Item[]>('/admin/configuracion'), []);
  return (
    <>
      <Titulo>Configuración del negocio</Titulo>
      <div className="mb-4">
        <Alerta tipo="info">
          El asistente solo usa los datos marcados como <strong>confirmados</strong>. Los pendientes se muestran al cliente como “por confirmar con un asesor”. No inventes datos: déjalos pendientes hasta tenerlos claros.
        </Alerta>
      </div>
      {cfg.error && <Alerta>{cfg.error}</Alerta>}
      {!cfg.datos ? (
        <Cargando />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {cfg.datos.map((i) => (
            <FilaConfig key={i.clave} item={i} editable={puede('admin')} onGuardado={cfg.recargar} />
          ))}
        </div>
      )}
    </>
  );
}

function FilaConfig({ item, editable, onGuardado }: { item: Item; editable: boolean; onGuardado: () => void }) {
  const [texto, setTexto] = useState(aTexto(item.clave, item.valor));
  const [confirmado, setConfirmado] = useState(item.confirmado);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const cambiado = texto !== aTexto(item.clave, item.valor) || confirmado !== item.confirmado;

  const guardar = async () => {
    setError(null);
    setOk(false);
    try {
      const valor = desdeTexto(item.clave, texto);
      await apiAdmin(`/admin/configuracion/${item.clave}`, 'PUT', { valor, confirmado });
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error && !('codigo' in e) ? e.message : mensajeError(e));
    }
  };

  return (
    <Tarjeta>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{item.descripcion}</p>
            <p className="font-mono text-xs text-slate-500">{item.clave}</p>
          </div>
          {item.confirmado ? <Insignia color="verde" texto="Confirmado" /> : <InsigniaPendiente />}
        </div>
        <label htmlFor={`cfg-${item.clave}`} className="sr-only">
          Valor
        </label>
        <input
          id={`cfg-${item.clave}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={!editable}
          placeholder={LISTAS.includes(item.clave) ? 'Separados por coma' : NUMEROS.includes(item.clave) ? 'Número (COP / días)' : 'Pendiente de confirmar'}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        />
        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
              Dato confirmado por el propietario
            </label>
            <Boton tamano="sm" disabled={!cambiado} onClick={guardar}>
              Guardar
            </Boton>
          </div>
        )}
        {error && <Alerta>{error}</Alerta>}
        {ok && <Alerta tipo="exito">Guardado.</Alerta>}
      </div>
    </Tarjeta>
  );
}
