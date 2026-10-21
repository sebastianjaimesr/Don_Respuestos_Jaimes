import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { manejadorErrores } from './errores';
import { rutasPublicas } from './rutas/publicas';
import { rutasIntegraciones } from './rutas/integraciones';
import { rutasAdmin } from './rutas/admin';
import { pool } from './db';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.CONFIAR_PROXY) app.set('trust proxy', config.CONFIAR_PROXY); // detrás de Nginx/Render/etc.
  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGENES.split(',').map((o) => o.trim()),
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    }),
  );
  // Guardamos el cuerpo crudo para poder verificar firmas HMAC de webhooks
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );

  app.get('/api/salud', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, data: { estado: 'ok', base_datos: 'ok' } });
    } catch {
      res.status(503).json({ ok: false, error: { codigo: 'BD_NO_DISPONIBLE', mensaje: 'La base de datos no responde' } });
    }
  });

  app.use('/api', rutasPublicas);
  app.use('/api', rutasIntegraciones);
  app.use('/api', rutasAdmin);

  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: { codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'Ruta no encontrada' } }));
  app.use(manejadorErrores);
  return app;
}
