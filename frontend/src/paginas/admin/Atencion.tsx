import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin, qs } from '../../api/cliente';
import { etiqueta, fecha } from '../../api/formato';
import { Alerta, Boton, Cargando, Insignia, mensajeError, Selector, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Transferencia {
  id: number;
  conversacion_id: string | null;
  motivo: string;
  detalle: string | null;
  estado: string;
  notificado: boolean;
  asesor: string | null;
  canal: string | null;
  cliente: string | null;
  ultimo_mensaje: string | null;
  created_at: string;
}
interface Mensaje {
  id: number;
  rol: 'cliente' | 'asistente' | 'asesor' | 'sistema';
  contenido: string;
  created_at: string;
  metadata: { asesor?: string };
}

export default function Atencion() {
  const [estado, setEstado] = useState('pendiente');
  const [sel, setSel] = useState<Transferencia | null>(null);
  const lista = useCarga(() => apiAdmin<{ items: Transferencia[] }>(`/admin/transferencias${qs({ estado })}`), [estado]);

  // Refresca la lista cada 15 s para ver nuevas solicitudes
  useEffect(() => {
    const t = setInterval(() => void lista.recargar(), 15000);
    return () => clearInterval(t);
  }, [lista.recargar]);

  return (
    <>
      <Titulo>Atención humana</Titulo>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Tarjeta
          titulo="Solicitudes"
          acciones={
            <div className="w-44">
              <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todas</option>
                <option value="pendiente">Pendientes</option>
                <option value="en_atencion">En atención</option>
                <option value="resuelta">Resueltas</option>
              </Selector>
            </div>
          }
        >
          {lista.error && <Alerta>{lista.error}</Alerta>}
          {!lista.datos ? (
            <Cargando />
          ) : lista.datos.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No hay solicitudes en este estado.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {lista.datos.items.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSel(t)} className={`flex w-full flex-col gap-1 rounded-lg px-2 py-3 text-left hover:bg-slate-50 ${sel?.id === t.id ? 'bg-marca-50' : ''}`}>
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      #{t.id} · {etiqueta(t.motivo)} <Insignia valor={t.estado} />
                      {t.canal && <span className="text-xs font-normal text-slate-500">{t.canal}</span>}
                    </span>
                    {t.ultimo_mensaje && <span className="line-clamp-1 text-sm text-slate-600">“{t.ultimo_mensaje}”</span>}
                    <span className="text-xs text-slate-500">
                      {fecha(t.created_at)} · {t.notificado ? 'notificado por n8n' : 'sin notificación externa'}
                      {t.asesor && ` · ${t.asesor}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        {sel ? (
          <Conversacion
            key={sel.id}
            t={sel}
            onCambio={(nuevo) => {
              setSel({ ...sel, estado: nuevo });
              void lista.recargar();
            }}
          />
        ) : (
          <Tarjeta>
            <p className="py-10 text-center text-sm text-slate-500">Selecciona una solicitud para ver la conversación.</p>
          </Tarjeta>
        )}
      </div>
    </>
  );
}

function Conversacion({ t, onCambio }: { t: Transferencia; onCambio: (estado: string) => void }) {
  const { puede } = useAuth();
  const conv = useCarga(() => apiAdmin<{ conversacion: { canal: string; moto: { modelo?: string; anio?: number } } | null; mensajes: Mensaje[] }>(`/admin/transferencias/${t.id}/mensajes`), [t.id]);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const i = setInterval(() => void conv.recargar(), 8000);
    return () => clearInterval(i);
  }, [conv.recargar]);

  const cambiar = async (estado: string) => {
    setError(null);
    try {
      await apiAdmin(`/admin/transferencias/${t.id}`, 'PATCH', { estado });
      onCambio(estado);
    } catch (e) {
      setError(mensajeError(e));
    }
  };
  const responder = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await apiAdmin<{ entregado: string }>(`/admin/transferencias/${t.id}/mensajes`, 'POST', { texto });
      setTexto('');
      setAviso(
        r.entregado === 'no_enviado'
          ? 'El mensaje quedó guardado, pero NO se envió: el canal externo no está configurado (N8N_SALIENTE_URL). Contacta al cliente por otro medio.'
          : null,
      );
      if (t.estado === 'pendiente') onCambio('en_atencion');
      void conv.recargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  const moto = conv.datos?.conversacion?.moto;
  return (
    <Tarjeta
      titulo={`Solicitud #${t.id}`}
      acciones={
        puede('admin', 'vendedor') && (
          <div className="flex gap-2">
            {t.estado === 'pendiente' && (
              <Boton tamano="sm" onClick={() => cambiar('en_atencion')}>
                Tomar conversación
              </Boton>
            )}
            {t.estado !== 'resuelta' && (
              <Boton tamano="sm" variante="secundario" onClick={() => cambiar('resuelta')}>
                Marcar resuelta
              </Boton>
            )}
          </div>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {etiqueta(t.motivo)}
        {t.detalle && ` · ${t.detalle}`}
        {moto?.modelo && ` · Moto: ${moto.modelo} ${moto.anio ?? ''}`}
      </p>
      {t.estado === 'en_atencion' && <p className="mb-3 text-xs text-violet-800">Mientras esté “en atención”, el asistente automático no responde en esta conversación.</p>}
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}
      {!conv.datos ? (
        <Cargando />
      ) : (
        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
          {conv.datos.mensajes.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-sm ${
                m.rol === 'cliente' ? 'self-start border border-slate-200 bg-white' : m.rol === 'asesor' ? 'self-end bg-violet-700 text-white' : 'self-end bg-marca-100 text-slate-800'
              }`}
            >
              <span className="mb-0.5 block text-[11px] opacity-70">
                {m.rol === 'cliente' ? 'Cliente' : m.rol === 'asesor' ? `Asesor${m.metadata?.asesor ? ' · ' + m.metadata.asesor : ''}` : 'Asistente'} · {fecha(m.created_at)}
              </span>
              {m.contenido}
            </div>
          ))}
        </div>
      )}
      {puede('admin', 'vendedor') && t.estado !== 'resuelta' && t.conversacion_id && (
        <form onSubmit={responder} className="mt-3 flex gap-2">
          <label htmlFor="resp" className="sr-only">
            Respuesta
          </label>
          <input id="resp" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Escribe tu respuesta al cliente" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <Boton type="submit" disabled={!texto.trim()}>
            Enviar
          </Boton>
        </form>
      )}
    </Tarjeta>
  );
}
