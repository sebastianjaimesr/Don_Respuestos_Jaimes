import { pool, enTransaccion } from '../../db';
import { AppError } from '../../errores';
import { calcularLineas, ItemSolicitado } from '../ventas/lineas';
import { costoEnvioConfirmado, valorConfirmado } from '../negocio/servicio';
import { registrarEvento } from '../eventos/servicio';

export interface EntradaCotizacion {
  items: ItemSolicitado[];
  modalidad_entrega?: 'recogida_tienda' | 'envio' | null;
  ciudad?: string | null;
  cliente_id?: number | null;
  conversacion_id?: string | null;
}

/** Crea una cotización con totales calculados por el servidor. */
export async function crearCotizacion(entrada: EntradaCotizacion) {
  const envioAplica = entrada.modalidad_entrega !== 'recogida_tienda';
  const costo = envioAplica && entrada.modalidad_entrega === 'envio' ? await costoEnvioConfirmado(entrada.ciudad) : null;
  const dias = await valorConfirmado<number>('vigencia_cotizacion_dias');

  const cot = await enTransaccion(async (db) => {
    // Sin bloqueo: una cotización no reserva unidades.
    const t = await calcularLineas(db, entrada.items, { bloquear: false, costoEnvio: costo, envioAplica });
    const { rows } = await db.query(
      `INSERT INTO cotizaciones (cliente_id, conversacion_id, subtotal, costo_envio, envio_confirmado, total, vigente_hasta)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END)
       RETURNING id, codigo, estado, fecha_emision, vigente_hasta`,
      [entrada.cliente_id ?? null, entrada.conversacion_id ?? null, t.subtotal, t.costo_envio, t.envio_confirmado, t.total, typeof dias === 'number' ? dias : null],
    );
    const c = rows[0] as { id: number; codigo: string; estado: string; fecha_emision: Date; vigente_hasta: Date | null };
    for (const l of t.lineas) {
      await db.query(
        `INSERT INTO detalle_cotizacion (cotizacion_id, producto_id, descripcion, referencia, tipo, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [c.id, l.producto_id, l.descripcion, l.referencia, l.tipo, l.cantidad, l.precio_unitario, l.subtotal],
      );
    }
    return { ...c, ...t, modalidad_entrega: entrada.modalidad_entrega ?? null };
  });
  void registrarEvento('info', 'cotizacion_creada', `Cotización ${cot.codigo} creada`, { codigo: cot.codigo, total: cot.total });
  return cot;
}

export async function obtenerCotizacion(codigo: string) {
  const { rows } = await pool.query(
    `SELECT id, codigo, estado, subtotal, costo_envio, envio_confirmado, total, fecha_emision, vigente_hasta, conversacion_id
     FROM cotizaciones WHERE codigo = $1`,
    [codigo],
  );
  if (!rows[0]) throw new AppError(404, 'COTIZACION_NO_ENCONTRADA', 'No existe esa cotización');
  const det = await pool.query(
    `SELECT producto_id, descripcion, referencia, tipo, cantidad, precio_unitario, subtotal FROM detalle_cotizacion WHERE cotizacion_id = $1 ORDER BY id`,
    [rows[0].id],
  );
  return { ...rows[0], lineas: det.rows };
}
