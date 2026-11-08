import { Router } from 'express';
import { aplicarEventoPago, pasarelaActiva } from '../modulos/pagos/servicio';
import { h } from '../utils/http';

/**
 * Avisos de la pasarela (webhooks). Wompi llama aquí cuando cambia una transacción.
 * URL a registrar en el panel de Wompi: https://<backend>/api/pagos/wompi/eventos
 */
export const rutasPagos = Router();

rutasPagos.post(
  '/pagos/wompi/eventos',
  h(async (req, res) => {
    const pasarela = pasarelaActiva();
    if (!pasarela) {
      res.status(503).json({ ok: false, error: { codigo: 'PAGO_EN_LINEA_NO_DISPONIBLE', mensaje: 'Wompi no está configurado' } });
      return;
    }
    const encabezado = req.headers['x-event-checksum'];
    const ev = pasarela.verificarEvento(req.body, typeof encabezado === 'string' ? encabezado : undefined);
    if (!ev) {
      // Firma inválida o evento que no manejamos: no se toca nada.
      res.status(401).json({ ok: false, error: { codigo: 'FIRMA_INVALIDA', mensaje: 'Evento no verificado' } });
      return;
    }
    const r = await aplicarEventoPago(ev);
    // 200 aunque no se aplique (p. ej. referencia desconocida): así Wompi no reintenta sin fin.
    res.json({ ok: true, data: { recibido: true, aplicado: r.aplicado } });
  }),
);
