import { pool } from '../../db';

type Nivel = 'info' | 'aviso' | 'error';

// Claves que nunca deben quedar en los registros
const SENSIBLES = /(password|contrasena|token|secret|firma|telefono|direccion|email|authorization)/i;

function limpiar(datos: unknown, profundidad = 0): unknown {
  if (profundidad > 4 || datos === null || typeof datos !== 'object') return datos;
  if (Array.isArray(datos)) return datos.map((d) => limpiar(d, profundidad + 1));
  return Object.fromEntries(
    Object.entries(datos as Record<string, unknown>).map(([k, v]) => [k, SENSIBLES.test(k) ? '[oculto]' : limpiar(v, profundidad + 1)]),
  );
}

/**
 * Guarda un evento en registros_eventos. Nunca lanza: si la BD falla,
 * se escribe en consola para no tumbar la operación principal.
 */
export async function registrarEvento(nivel: Nivel, tipo: string, mensaje: string, datos: Record<string, unknown> = {}): Promise<void> {
  const limpio = limpiar(datos);
  if (process.env.NODE_ENV !== 'test' || nivel === 'error') {
    const linea = `[${new Date().toISOString()}] ${nivel.toUpperCase()} ${tipo}: ${mensaje}`;
    (nivel === 'error' ? console.error : console.log)(linea, nivel === 'error' ? JSON.stringify(limpio) : '');
  }
  try {
    await pool.query('INSERT INTO registros_eventos (nivel, tipo, mensaje, datos) VALUES ($1, $2, $3, $4)', [
      nivel,
      tipo.slice(0, 60),
      mensaje.slice(0, 2000),
      JSON.stringify(limpio),
    ]);
  } catch (e) {
    console.error('No se pudo guardar el evento en BD:', (e as Error).message);
  }
}
