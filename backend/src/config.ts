import 'dotenv/config';
import { z } from 'zod';

/**
 * Configuración leída SOLO de variables de entorno.
 * Si falta algo obligatorio, el servidor no arranca (mejor fallar al inicio
 * que descubrir el problema con un cliente esperando).
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRA_EN: z.string().default('8h'),
  CORS_ORIGENES: z.string().default('http://localhost:5173'),
  // Integración n8n (opcional)
  WEBHOOK_SECRET: z.string().min(32).optional(),
  N8N_NOTIFICACION_URL: z.string().url().optional(),
  N8N_SALIENTE_URL: z.string().url().optional(),
  // Límites de solicitudes
  RATE_LIMIT_CHAT_POR_MINUTO: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_LOGIN_POR_15MIN: z.coerce.number().int().positive().default(10),
  CONFIAR_PROXY: z.coerce.number().int().min(0).default(0),
  // Imágenes de productos (docs/ARQUITECTURA.md § 8). Sin esto, el panel no permite subir fotos.
  ALMACENAMIENTO: z.enum(['supabase', 'local']).optional(),
  SUPABASE_URL: z.string().url().optional(),
  /** Clave service_role: SOLO en el backend, nunca en el frontend. */
  SUPABASE_SERVICE_KEY: z.string().min(20).optional(),
  SUPABASE_BUCKET: z.string().regex(/^[a-z0-9_-]{3,63}$/).default('productos'),
  /** Carpeta para el modo local (desarrollo y pruebas). */
  ALMACENAMIENTO_LOCAL_DIR: z.string().default('uploads'),
});

const vaciosComoUndefined = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

const resultado = esquema
  .refine((c) => c.ALMACENAMIENTO !== 'supabase' || (c.SUPABASE_URL && c.SUPABASE_SERVICE_KEY), {
    message: 'Con ALMACENAMIENTO=supabase debes definir SUPABASE_URL y SUPABASE_SERVICE_KEY',
    path: ['ALMACENAMIENTO'],
  })
  .safeParse(vaciosComoUndefined);
if (!resultado.success) {
  // No imprimimos los valores, solo qué variable falla (evita filtrar secretos)
  const problemas = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  throw new Error(`Configuración inválida:\n  ${problemas}`);
}

export const config = resultado.data;
export type Config = typeof config;
