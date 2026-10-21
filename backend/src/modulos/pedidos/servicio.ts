import { z } from 'zod';
import { pool, enTransaccion } from '../../db';
import { AppError } from '../../errores';
import { calcularLineas } from '../ventas/lineas';
import { upsertCliente } from '../clientes/servicio';
import { costoEnvioConfirmado } from '../negocio/servicio';
import { registrarEvento } from '../eventos/servicio';
import { normalizarTelefono } from '../../utils/texto';

export const METODOS_PAGO = ['nequi', 'daviplata', 'transferencia', 'efectivo', 'contraentrega'] as const;

export const esquemaRegistrarPedido = z
  .object({
    cliente: z.object({
      nombre: z.string().trim().min(2).max(120),
      telefono: z.string().trim().refine((t) => normalizarTelefono(t) !== null, 'Teléfono colombiano inválido'),
      ciudad: z.string().trim().min(2).max(80),
      direccion: z.string().trim().max(200).optional().nullable(),
      email: z.string().trim().email().max(160).optional().nullable(),
    }),
    items: z
      .array(z.object({ producto_id: z.number().int().positive(), cantidad: z.number().int().positive().max(100) }))
      .min(1)
      .max(30),
    entrega: z.object({
      modalidad: z.enum(['recogida_tienda', 'envio']),
      ciudad: z.string().trim().min(2).max(80).optional().nullable(),
      direccion: z.string().trim().min(5).max(200).optional().nullable(),
    }),
    metodo_pago: z.enum(METODOS_PAGO),
    // Debe ser literalmente true: el cliente confirmó explícitamente.
    confirmado_por_cliente: z.boolean(),
    clave_idempotencia: z.string().trim().min(8).max(120),
    conversacion_id: z.string().uuid().optional().nullable(),
    cotizacion_codigo: z.string().max(20).optional().nullable(),
    notas: z.string().max(500).optional().nullable(),
  })
  .refine((d) => d.entrega.modalidad !== 'envio' || (d.entrega.direccion && (d.entrega.ciudad || d.cliente.ciudad)), {
    message: 'Para envío se requiere dirección completa y ciudad',
    path: ['entrega', 'direccion'],
  });

export type EntradaPedido = z.infer<typeof esquemaRegistrarPedido>;

async function buscarPorClave(clave: string) {
  const { rows } = await pool.query('SELECT codigo FROM pedidos WHERE clave_idempotencia = $1', [clave]);
  return rows[0]?.codigo as string | undefined;
}

/**
 * HERRAMIENTA registrar_pedido(cliente, items, entrega)
 * - Exige confirmación explícita del cliente.
 * - Idempotente: la misma clave devuelve el mismo pedido (no lo duplica).
 * - En UNA transacción: bloquea inventario, valida stock y precios, calcula
 *   totales, guarda pedido + detalle, descuenta stock y deja movimientos.
 */
export async function registrarPedido(entradaCruda: unknown) {
  const entrada = esquemaRegistrarPedido.parse(entradaCruda);
  if (entrada.confirmado_por_cliente !== true) {
    throw new AppError(400, 'CONFIRMACION_REQUERIDA', 'El cliente debe confirmar explícitamente el pedido antes de registrarlo');
  }

  const existente = await buscarPorClave(entrada.clave_idempotencia);
  if (existente) return { ...(await obtenerPedido(existente)), idempotente: true };

  const ciudadEntrega = entrada.entrega.ciudad ?? entrada.cliente.ciudad;
  const envioAplica = entrada.entrega.modalidad === 'envio';
  const costo = envioAplica ? await costoEnvioConfirmado(ciudadEntrega) : null;

  try {
    const codigo = await enTransaccion(async (db) => {
      const clienteId = await upsertCliente(db, {
        nombre: entrada.cliente.nombre,
        telefono: entrada.cliente.telefono,
        ciudad: entrada.cliente.ciudad,
        direccion: entrada.cliente.direccion ?? entrada.entrega.direccion ?? null,
        email: entrada.cliente.email ?? null,
      });

      const t = await calcularLineas(db, entrada.items, { bloquear: true, costoEnvio: costo, envioAplica });

      let cotizacionId: number | null = null;
      if (entrada.cotizacion_codigo) {
        const c = await db.query(`UPDATE cotizaciones SET estado = 'aceptada', cliente_id = COALESCE(cliente_id, $2) WHERE codigo = $1 AND estado = 'emitida' RETURNING id`, [
          entrada.cotizacion_codigo,
          clienteId,
        ]);
        cotizacionId = c.rows[0]?.id ?? null;
      }

      const { rows } = await db.query(
        `INSERT INTO pedidos (cliente_id, cotizacion_id, conversacion_id, modalidad_entrega, ciudad_entrega, direccion_entrega,
                              metodo_pago, subtotal, costo_envio, envio_confirmado, total, confirmado_por_cliente, clave_idempotencia, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13)
         RETURNING id, codigo`,
        [
          clienteId,
          cotizacionId,
          entrada.conversacion_id ?? null,
          entrada.entrega.modalidad,
          envioAplica ? ciudadEntrega : null,
          envioAplica ? entrada.entrega.direccion : null,
          entrada.metodo_pago,
          t.subtotal,
          t.costo_envio,
          t.envio_confirmado,
          t.total,
          entrada.clave_idempotencia,
          entrada.notas ?? null,
        ],
      );
      const pedido = rows[0];

      for (const l of t.lineas) {
        await db.query(
          `INSERT INTO detalle_pedido (pedido_id, producto_id, descripcion, referencia, tipo, cantidad, precio_unitario, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [pedido.id, l.producto_id, l.descripcion, l.referencia, l.tipo, l.cantidad, l.precio_unitario, l.subtotal],
        );
        // El CHECK (cantidad >= 0) de la tabla es la última barrera contra stock negativo.
        await db.query('UPDATE inventario SET cantidad = cantidad - $2 WHERE producto_id = $1', [l.producto_id, l.cantidad]);
        await db.query(
          `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, motivo, pedido_id)
           VALUES ($1, 'venta', $2, $3, $4, $5, $6)`,
          [l.producto_id, -l.cantidad, l.stock_disponible, l.stock_disponible - l.cantidad, `Pedido ${pedido.codigo}`, pedido.id],
        );
      }
      return pedido.codigo as string;
    });

    void registrarEvento('info', 'pedido_registrado', `Pedido ${codigo} registrado`, { codigo });
    return { ...(await obtenerPedido(codigo)), idempotente: false };
  } catch (e) {
    // Dos solicitudes con la misma clave al mismo tiempo: la segunda choca con el UNIQUE.
    if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'pedidos_clave_idempotencia_key') {
      const cod = await buscarPorClave(entrada.clave_idempotencia);
      if (cod) return { ...(await obtenerPedido(cod)), idempotente: true };
    }
    if (e instanceof AppError) {
      void registrarEvento('aviso', 'pedido_rechazado', e.message, { codigo: e.codigo });
    }
    throw e;
  }
}

export async function obtenerPedido(codigo: string) {
  const { rows } = await pool.query(
    `SELECT pe.id, pe.codigo, pe.estado, pe.modalidad_entrega, pe.ciudad_entrega, pe.direccion_entrega, pe.metodo_pago, pe.estado_pago,
            pe.subtotal, pe.costo_envio, pe.envio_confirmado, pe.total, pe.created_at, pe.updated_at, pe.notas,
            cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono, cl.ciudad AS cliente_ciudad,
            co.codigo AS cotizacion_codigo, pe.conversacion_id
     FROM pedidos pe JOIN clientes cl ON cl.id = pe.cliente_id LEFT JOIN cotizaciones co ON co.id = pe.cotizacion_id
     WHERE pe.codigo = $1`,
    [codigo],
  );
  if (!rows[0]) throw new AppError(404, 'PEDIDO_NO_ENCONTRADO', 'No existe ese pedido');
  const det = await pool.query(
    'SELECT producto_id, descripcion, referencia, tipo, cantidad, precio_unitario, subtotal FROM detalle_pedido WHERE pedido_id = $1 ORDER BY id',
    [rows[0].id],
  );
  return { ...rows[0], lineas: det.rows };
}

/** Seguimiento público: exige código + teléfono y devuelve lo mínimo (protección de datos). */
export async function seguimientoPedido(codigo: string, telefono: string) {
  const tel = normalizarTelefono(telefono);
  if (!tel) throw new AppError(400, 'TELEFONO_INVALIDO', 'Teléfono inválido');
  const { rows } = await pool.query(
    `SELECT pe.codigo, pe.estado, pe.estado_pago, pe.modalidad_entrega, pe.total, pe.envio_confirmado, pe.created_at, pe.updated_at
     FROM pedidos pe JOIN clientes cl ON cl.id = pe.cliente_id WHERE pe.codigo = $1 AND cl.telefono = $2`,
    [codigo.trim().toUpperCase(), tel],
  );
  // Mismo mensaje si no existe o si el teléfono no coincide: no revelamos qué falló.
  if (!rows[0]) throw new AppError(404, 'PEDIDO_NO_ENCONTRADO', 'No encontramos un pedido con ese código y teléfono');
  return rows[0];
}

// Transiciones de estado permitidas
const TRANSICIONES: Record<string, string[]> = {
  registrado: ['confirmado', 'cancelado'],
  confirmado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['enviado', 'entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
};

/** Cambia el estado de un pedido. Si se cancela, devuelve las unidades al inventario. */
export async function cambiarEstadoPedido(codigo: string, cambios: { estado?: string; estado_pago?: string }, asesorId: number) {
  await enTransaccion(async (db) => {
    const { rows } = await db.query('SELECT id, estado FROM pedidos WHERE codigo = $1 FOR UPDATE', [codigo]);
    const p = rows[0];
    if (!p) throw new AppError(404, 'PEDIDO_NO_ENCONTRADO', 'No existe ese pedido');
    if (cambios.estado && cambios.estado !== p.estado) {
      if (!TRANSICIONES[p.estado]?.includes(cambios.estado)) {
        throw new AppError(409, 'TRANSICION_INVALIDA', `No se puede pasar de "${p.estado}" a "${cambios.estado}"`);
      }
      if (cambios.estado === 'cancelado') {
        const det = await db.query(
          `SELECT d.producto_id, d.cantidad, i.cantidad AS stock FROM detalle_pedido d
           JOIN inventario i ON i.producto_id = d.producto_id WHERE d.pedido_id = $1 ORDER BY d.producto_id FOR UPDATE OF i`,
          [p.id],
        );
        for (const d of det.rows) {
          await db.query('UPDATE inventario SET cantidad = cantidad + $2 WHERE producto_id = $1', [d.producto_id, d.cantidad]);
          await db.query(
            `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, motivo, pedido_id, asesor_id)
             VALUES ($1, 'devolucion', $2, $3, $4, $5, $6, $7)`,
            [d.producto_id, d.cantidad, d.stock, d.stock + d.cantidad, `Cancelación de ${codigo}`, p.id, asesorId],
          );
        }
      }
      await db.query('UPDATE pedidos SET estado = $2 WHERE id = $1', [p.id, cambios.estado]);
    }
    if (cambios.estado_pago) await db.query('UPDATE pedidos SET estado_pago = $2 WHERE id = $1', [p.id, cambios.estado_pago]);
  });
  void registrarEvento('info', 'pedido_actualizado', `Pedido ${codigo} actualizado`, { codigo, ...cambios, asesor_id: asesorId });
  return obtenerPedido(codigo);
}
