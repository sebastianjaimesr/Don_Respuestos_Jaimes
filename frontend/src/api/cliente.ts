/** Cliente HTTP mínimo con manejo de errores consistente. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') + '/api';
const CLAVE_TOKEN = 'drj_token';

export class ErrorApi extends Error {
  constructor(public status: number, public codigo: string, mensaje: string, public detalles?: unknown) {
    super(mensaje);
  }
}

// El token se guarda en sessionStorage: se borra al cerrar la pestaña.
export const sesion = {
  token: () => {
    try {
      return sessionStorage.getItem(CLAVE_TOKEN);
    } catch {
      return null;
    }
  },
  guardar: (t: string) => sessionStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => sessionStorage.removeItem(CLAVE_TOKEN),
};

let alExpirar: (() => void) | null = null;
export const registrarAlExpirar = (fn: () => void) => (alExpirar = fn);

// El backend en un plan gratuito se "duerme" y tarda en despertar: por eso el límite es amplio.
const ESPERA_MAXIMA_MS = 70_000;

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; auth?: boolean; esperaMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (opciones.auth) {
    const t = sesion.token();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), opciones.esperaMs ?? ESPERA_MAXIMA_MS);
  try {
    res = await fetch(BASE + ruta, {
      method: opciones.metodo ?? 'GET',
      headers,
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: control.signal,
    });
  } catch {
    if (control.signal.aborted) {
      throw new ErrorApi(0, 'SIN_RESPUESTA', 'El servidor no respondió a tiempo. Si estaba en pausa, espera un momento e intenta de nuevo.');
    }
    throw new ErrorApi(0, 'SIN_CONEXION', 'No pudimos conectarnos con el servidor. Revisa tu conexión e intenta de nuevo.');
  } finally {
    clearTimeout(limite);
  }
  const datos = await res.json().catch(() => null);
  if (!res.ok || !datos?.ok) {
    if (res.status === 401 && opciones.auth) {
      sesion.borrar();
      alExpirar?.();
    }
    const e = datos?.error ?? {};
    throw new ErrorApi(res.status, e.codigo ?? 'ERROR', e.mensaje ?? 'Ocurrió un error inesperado', e.detalles);
  }
  return datos.data as T;
}

/** Atajo para el panel (siempre autenticado) */
export const apiAdmin = <T,>(ruta: string, metodo = 'GET', cuerpo?: unknown) => api<T>(ruta, { metodo, cuerpo, auth: true });

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
