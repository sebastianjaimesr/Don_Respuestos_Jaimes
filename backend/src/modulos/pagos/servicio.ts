import { randomBytes } from 'node:crypto';
import { config } from '../../config';
import { Consultor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { aCentavos } from '../../utils/dinero';
import { normalizarTelefono } from '../../utils/texto';
import type { EventoPago, IntencionPago, PasarelaPagos } from './pasarela';
import { crearWompi } from './wompi';

/** La pasarela configurada, o null si faltan las llaves (entonces no hay pago en línea). */
export function pasarelaActiva(): PasarelaPagos | null {
  if (config.WOMPI_LLAVE_PUBLICA && config.WOMPI_SECRETO_INTEGRIDAD && config.WOMPI_SECRETO_EVENTOS) {
    return crearWompi({ llavePublica: config.WOMPI_LLAVE_PUBLICA, secretoIntegridad: config.WOMPI_SECRETO_INTEGRIDAD, secretoEventos: config.WOMPI_SECRETO_EVENTOS });
  }
  return null;
}

export function opcionesDePago() {
  const p = pasarelaActiva();
  return {
    en_linea: Boolean(p),
    proveedor: p?.nombre ?? null,
    // Llave de pruebas: los pagos no mueven dinero real. Se muestra para no confundir.
    modo_pruebas: Boolean(config.WOMPI_LLAVE_PUBLICA?.startsWith('pub_test_')),
  };
}

/**
 * El pedido pasa a "confirmado" cuando la suma de pagos aprobados cubre el total.
 * Si no lo cubre, el estado no se toca (un asesor pudo marcarlo a mano).
 * Se usa con el pago manual del panel y con los eventos de la pasarela.
 */
export async function recalcularEstadoPago(db: Consultor, pedidoId: number) {
  const { rows } = await db.query(
    `SELECT pe.total, pe.estado_pago, COALESCE(SUM(pg.monto) FILTER (WHERE pg.estado = 'aprobado'), 0) AS pagado
     FROM pedidos pe LEFT JOIN pagos pg ON pg.pedido_id = pe.id WHERE pe.id = $1 GROUP BY pe.id`,
    [pedidoId],
  );
  const r = rows[0];
  const estado = aCentavos(String(r.pagado)) >= aCentavos(r.total) ? 'confirmado' : r.estado_pago;
  if (estado !== r.estado_pago) await db.query('UPDATE pedidos SET estado_pago = $2 WHERE id = $1', [pedidoId, estado]);
  return { estado_pago: estado as string, pagado: String(r.pagado), total: String(r.total) };
}

/**
 * Crea el enlace de pago en línea de un pedido. Lo pide el cliente con el código y
 * su celular (lo mismo que para consultar el pedido). Solo se puede pagar en línea
 * cuando el total es definitivo: si el envío está "por confirmar", aún no hay total.
 */
export async function iniciarPagoEnLinea(codigo: string, telefono: string): Promise<IntencionPago> {
  const pasarela = pasarelaActiva();
  if (!pasarela) throw new AppError(503, 'PAGO_EN_LINEA_NO_DISPONIBLE', 'El pago en línea no está activo. Un asesor te confirma cómo pagar por WhatsApp.');
  const tel = normalizarTelefono(telefono);
  if (!tel) throw new AppError(400, 'TELEFONO_INVALIDO', 'Teléfono inválido');

  return enTransaccion(async (db) => {
    const pe = (
      await db.query(
        `SELECT pe.id, pe.codigo, pe.estado, pe.estado_pago, pe.total, pe.envio_confirmado
         FROM pedidos pe JOIN clientes cl ON cl.id = pe.cliente_id WHERE pe.codigo = $1 AND cl.telefono = $2 FOR UPDATE OF pe`,
        [codigo.trim().toUpperCase(), tel],
      )
    ).rows[0];
    if (!pe) throw new AppError(404, 'PEDIDO_NO_ENCONTRADO', 'No encontramos un pedido con ese código y teléfono');
    if (pe.estado === 'cancelado') throw new AppError(409, 'PEDIDO_CANCELADO', 'El pedido está cancelado');
    if (pe.estado_pago === 'confirmado') throw new AppError(409, 'PEDIDO_PAGADO', 'Este pedido ya está pagado');
    if (!pe.envio_confirmado) {
      throw new AppError(409, 'TOTAL_POR_CONFIRMAR', 'El costo del envío aún no está confirmado. Un asesor te escribe con el total y después puedes pagar.');
    }
    const pagado = aCentavos(String((await db.query(`SELECT COALESCE(SUM(monto), 0) AS s FROM pagos WHERE pedido_id = $1 AND estado = 'aprobado'`, [pe.id])).rows[0].s));
    const saldo = aCentavos(pe.total) - pagado;
    if (saldo <= 0) throw new AppError(409, 'PEDIDO_PAGADO', 'Este pedido ya está pagado');

    // Una referencia nueva por intento (Wompi no acepta repetirlas). Los intentos anteriores
    // sin respuesta quedan "pendiente": no suman nada.
    const referencia = `${pe.codigo}-${randomBytes(4).toString('hex').toUpperCase()}`;
    await db.query(
      `INSERT INTO pagos (pedido_id, proveedor, referencia_externa, monto, estado) VALUES ($1, $2, $3, $4, 'pendiente')`,
      [pe.id, pasarela.nombre, referencia, (saldo / 100).toFixed(2)],
    );
    const retorno = config.TIENDA_URL ? `${config.TIENDA_URL.replace(/\/$/, '')}/pedido/${pe.codigo}?pago=volvio` : null;
    return pasarela.crearIntencion({ referencia, monto_centavos: saldo, url_retorno: retorno });
  });
}

/**
 * Procesa un evento de la pasarela YA verificado. Es idempotente: Wompi reintenta
 * los eventos y el mismo puede llegar varias veces.
 */
export async function aplicarEventoPago(ev: EventoPago) {
  return enTransaccion(async (db) => {
    const pago = (
      await db.query(`SELECT id, pedido_id, monto, estado, payload FROM pagos WHERE proveedor = $1 AND referencia_externa = $2 FOR UPDATE`, [ev.proveedor, ev.referencia])
    ).rows[0];
    if (!pago) return { aplicado: false, motivo: 'referencia_desconocida' };
    // Una misma transacción no puede pagar dos pedidos.
    const otra = await db.query(`SELECT 1 FROM pagos WHERE proveedor = $1 AND payload->>'transaccion' = $2 AND id <> $3`, [ev.proveedor, ev.transaccion, pago.id]);
    if (otra.rowCount) return { aplicado: false, motivo: 'transaccion_repetida' };
    if (ev.moneda !== 'COP' || ev.monto_centavos !== aCentavos(pago.monto)) {
      await db.query(`UPDATE pagos SET payload = $2 WHERE id = $1`, [pago.id, JSON.stringify({ transaccion: ev.transaccion, alerta: 'monto_distinto', evento: ev.payload })]);
      return { aplicado: false, motivo: 'monto_distinto' };
    }
    // Un pago aprobado no se devuelve a pendiente por un evento atrasado.
    if (pago.estado === 'aprobado' || ev.estado === 'pendiente') {
      if (pago.estado === 'pendiente') await db.query(`UPDATE pagos SET payload = $2 WHERE id = $1`, [pago.id, JSON.stringify({ transaccion: ev.transaccion, evento: ev.payload })]);
      return { aplicado: false, motivo: 'sin_cambio' };
    }
    await db.query(`UPDATE pagos SET estado = $2, metodo = $3, payload = $4 WHERE id = $1`, [
      pago.id,
      ev.estado,
      ev.metodo ? ev.metodo.slice(0, 16) : null,
      JSON.stringify({ transaccion: ev.transaccion, evento: ev.payload }),
    ]);
    const r = await recalcularEstadoPago(db, pago.pedido_id);
    return { aplicado: true, ...r };
  });
}

/** Pagos de un pedido, para el panel. */
export async function pagosDePedido(codigo: string) {
  const { rows } = await pool.query(
    `SELECT pg.id, pg.proveedor, pg.metodo, pg.referencia_externa, pg.monto, pg.estado, pg.created_at, pg.updated_at, a.nombre AS asesor,
            pg.payload->>'transaccion' AS transaccion
     FROM pagos pg JOIN pedidos pe ON pe.id = pg.pedido_id LEFT JOIN asesores a ON a.id = pg.asesor_id
     WHERE pe.codigo = $1 ORDER BY pg.id`,
    [codigo],
  );
  return rows;
}
