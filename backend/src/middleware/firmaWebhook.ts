import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { AppError } from '../errores';
import { verificarFirma } from '../utils/firma';
import { registrarEvento } from '../modulos/eventos/servicio';

/**
 * Valida que una solicitud venga de n8n (u otra integración autorizada):
 *   X-DRJ-Timestamp: segundos unix
 *   X-DRJ-Firma:     hex(HMAC-SHA256(WEBHOOK_SECRET, `${timestamp}.${cuerpo}`))
 */
export function requerirFirma(req: Request, _res: Response, next: NextFunction) {
  if (!config.WEBHOOK_SECRET) {
    return next(new AppError(503, 'INTEGRACION_NO_CONFIGURADA', 'La integración no está configurada (falta WEBHOOK_SECRET)'));
  }
  const ts = String(req.headers['x-drj-timestamp'] ?? '');
  const firma = String(req.headers['x-drj-firma'] ?? '');
  const cuerpo = req.rawBody?.toString('utf8') ?? '';
  if (!ts || !firma || !verificarFirma(config.WEBHOOK_SECRET, ts, cuerpo, firma)) {
    void registrarEvento('aviso', 'firma_invalida', 'Solicitud de integración con firma inválida', { ruta: req.path });
    return next(new AppError(401, 'FIRMA_INVALIDA', 'Firma inválida o expirada'));
  }
  next();
}
