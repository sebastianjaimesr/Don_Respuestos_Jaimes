import { z } from 'zod';

const id = z.number().int().positive();

export const esquemaAccion = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('agregar'), producto_id: id, cantidad: z.number().int().min(1).max(100).optional() }),
  z.object({ tipo: z.literal('quitar'), producto_id: id }),
  z.object({ tipo: z.literal('ver_carrito') }),
  z.object({ tipo: z.literal('cotizar') }),
  z.object({ tipo: z.literal('iniciar_pedido') }),
  z.object({
    tipo: z.literal('datos_entrega'),
    datos: z.object({
      nombre: z.string().max(120).optional(),
      telefono: z.string().max(20).optional(),
      ciudad: z.string().max(80).optional(),
      modalidad: z.enum(['recogida_tienda', 'envio']).optional(),
      direccion: z.string().max(200).optional(),
      metodo_pago: z.enum(['nequi', 'daviplata', 'transferencia', 'efectivo', 'contraentrega']).optional(),
    }),
  }),
  z.object({ tipo: z.literal('confirmar_pedido') }),
  z.object({ tipo: z.literal('rechazar_confirmacion') }),
  z.object({ tipo: z.literal('escalar') }),
  z.object({ tipo: z.literal('elegir_modelo'), modelo_id: id }),
  z.object({ tipo: z.literal('elegir_categoria'), categoria: z.string().max(40) }),
  z.object({ tipo: z.literal('elegir_posicion'), posicion: z.enum(['delantero', 'trasero']) }),
  z.object({ tipo: z.literal('nueva_busqueda') }),
]);

export const esquemaMensajeEntrante = z
  .object({
    texto: z.string().max(1000).optional(),
    accion: esquemaAccion.optional(),
    etiqueta_accion: z.string().max(80).optional(),
  })
  .refine((d) => d.texto !== undefined || d.accion !== undefined, { message: 'Envía texto o una acción' });
