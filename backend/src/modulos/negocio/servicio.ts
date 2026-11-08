import { pool } from '../../db';

export interface ItemConfig {
  clave: string;
  valor: unknown;
  descripcion: string;
  confirmado: boolean;
}

export async function obtenerConfiguracion(): Promise<Record<string, ItemConfig>> {
  const { rows } = await pool.query<ItemConfig>('SELECT clave, valor, descripcion, confirmado FROM configuracion_negocio ORDER BY clave');
  return Object.fromEntries(rows.map((r) => [r.clave, r]));
}

/** Valor solo si el propietario lo confirmó; si no, null (pendiente). */
export async function valorConfirmado<T = unknown>(clave: string): Promise<T | null> {
  const { rows } = await pool.query<{ valor: T; confirmado: boolean }>(
    'SELECT valor, confirmado FROM configuracion_negocio WHERE clave = $1',
    [clave],
  );
  const r = rows[0];
  return r && r.confirmado && r.valor !== null ? r.valor : null;
}

export interface CotizacionEnvio {
  ciudad: string;
  /** Costo en COP, o null si no hay un valor confirmado para esa ciudad (lo confirma un asesor). */
  costo: number | null;
  dias_estimados: number | null;
  /** De dónde salió el costo: la tabla de tarifas, la configuración general o ninguna. */
  fuente: 'tarifa' | 'configuracion' | null;
}

/**
 * Costo de envío para una ciudad. Primero busca en la tabla `tarifas_envio` (sin
 * importar tildes ni mayúsculas); si la ciudad no está, usa `costo_envio` de la
 * configuración solo si el dueño lo confirmó. Nunca inventa un valor.
 */
export async function cotizarEnvio(ciudad?: string | null): Promise<CotizacionEnvio> {
  const nombre = (ciudad ?? '').trim();
  if (nombre) {
    // Si la misma ciudad está en dos departamentos con costos distintos, no adivinamos.
    const { rows } = await pool.query<{ costo: string; dias_estimados: number | null }>(
      `SELECT costo, dias_estimados FROM tarifas_envio WHERE activo AND f_normalizar(ciudad) = f_normalizar($1)`,
      [nombre],
    );
    const costos = new Set(rows.map((r) => r.costo));
    if (rows.length && costos.size === 1) {
      const dias = rows.map((r) => r.dias_estimados).filter((d): d is number => d !== null);
      return { ciudad: nombre, costo: Number(rows[0].costo), dias_estimados: dias.length ? Math.max(...dias) : null, fuente: 'tarifa' };
    }
    if (rows.length) return { ciudad: nombre, costo: null, dias_estimados: null, fuente: null };
  }
  const v = await valorConfirmado<unknown>('costo_envio');
  if (typeof v === 'number' && v >= 0) return { ciudad: nombre, costo: v, dias_estimados: null, fuente: 'configuracion' };
  // Tabla por ciudad en la configuración (formato anterior): { "bogota": 15000, "default": 20000 }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const tabla = v as Record<string, number>;
    const clave = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const valor = tabla[clave] ?? tabla['default'];
    if (typeof valor === 'number' && valor >= 0) return { ciudad: nombre, costo: valor, dias_estimados: null, fuente: 'configuracion' };
  }
  return { ciudad: nombre, costo: null, dias_estimados: null, fuente: null };
}

/** Costo de envío confirmado (número) o null si no está confirmado. */
export async function costoEnvioConfirmado(ciudad?: string | null): Promise<number | null> {
  return (await cotizarEnvio(ciudad)).costo;
}

/** Información pública: los datos no confirmados se marcan como pendientes. */
export async function informacionPublica() {
  const cfg = await obtenerConfiguracion();
  const publicas = ['nombre', 'pais', 'moneda', 'horario', 'direccion', 'ciudades_envio', 'transportadoras', 'costo_envio', 'medios_pago', 'contacto_humano'];
  return Object.fromEntries(
    publicas
      .filter((k) => cfg[k])
      .map((k) => [k, { valor: cfg[k].confirmado ? cfg[k].valor : null, confirmado: cfg[k].confirmado, descripcion: cfg[k].descripcion }]),
  );
}
