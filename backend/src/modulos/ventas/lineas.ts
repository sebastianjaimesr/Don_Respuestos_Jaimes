import { Consultor } from '../../db';
import { AppError } from '../../errores';
import { aCentavos, aDecimal } from '../../utils/dinero';

export interface ItemSolicitado {
  producto_id: number;
  cantidad: number;
}

export interface LineaCalculada {
  producto_id: number;
  referencia: string;
  descripcion: string;
  tipo: 'original' | 'generico';
  cantidad: number;
  stock_disponible: number;
  precio_unitario: string;
  subtotal: string;
  es_demo: boolean;
}

export interface Totales {
  lineas: LineaCalculada[];
  subtotal: string;
  costo_envio: string | null;
  envio_confirmado: boolean;
  total: string;
}

/** Une ítems repetidos (mismo producto dos veces → se suman cantidades). */
export function consolidarItems(items: ItemSolicitado[]): ItemSolicitado[] {
  const mapa = new Map<number, number>();
  for (const it of items) {
    if (!Number.isInteger(it.cantidad) || it.cantidad <= 0) {
      throw new AppError(400, 'CANTIDAD_INVALIDA', 'Las cantidades deben ser números enteros mayores que cero');
    }
    mapa.set(it.producto_id, (mapa.get(it.producto_id) ?? 0) + it.cantidad);
  }
  return [...mapa].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
}

/**
 * Valida productos (existen, activos, con precio confirmado y stock suficiente)
 * y calcula los totales EN EL SERVIDOR con aritmética de centavos.
 * Con `bloquear = true` toma un bloqueo FOR UPDATE sobre las filas de inventario:
 * cualquier otra transacción que quiera vender esos productos espera su turno.
 */
export async function calcularLineas(
  db: Consultor,
  itemsEntrada: ItemSolicitado[],
  opciones: { bloquear: boolean; costoEnvio: number | null; envioAplica: boolean },
): Promise<Totales> {
  const items = consolidarItems(itemsEntrada);
  if (!items.length) throw new AppError(400, 'SIN_ITEMS', 'Debes incluir al menos un producto');

  const ids = items.map((i) => i.producto_id).sort((a, b) => a - b);
  // ORDER BY id + FOR UPDATE: bloqueo en orden fijo para evitar interbloqueos (deadlocks)
  const { rows } = await db.query(
    `SELECT p.id, p.referencia, p.nombre, p.tipo, p.precio, p.activo, p.es_demo, i.cantidad AS stock
     FROM productos p JOIN inventario i ON i.producto_id = p.id
     WHERE p.id = ANY($1::int[])
     ORDER BY p.id
     ${opciones.bloquear ? 'FOR UPDATE OF i' : ''}`,
    [ids],
  );
  const porId = new Map(rows.map((r) => [r.id as number, r]));

  let subtotalC = 0;
  const lineas: LineaCalculada[] = [];
  for (const it of items) {
    const p = porId.get(it.producto_id);
    if (!p || !p.activo) throw new AppError(404, 'PRODUCTO_NO_ENCONTRADO', `El producto ${it.producto_id} no existe o no está activo`);
    if (p.precio === null) {
      throw new AppError(422, 'PRECIO_NO_CONFIRMADO', `El producto ${p.referencia} no tiene precio confirmado; un asesor debe confirmarlo`, { referencia: p.referencia });
    }
    const stock = p.stock ?? 0;
    if (stock < it.cantidad) {
      throw new AppError(409, 'STOCK_INSUFICIENTE', `Stock insuficiente para ${p.referencia}: disponibles ${stock}, solicitados ${it.cantidad}`, {
        referencia: p.referencia,
        disponible: stock,
        solicitado: it.cantidad,
      });
    }
    const precioC = aCentavos(p.precio);
    const lineaC = precioC * it.cantidad;
    subtotalC += lineaC;
    lineas.push({
      producto_id: p.id,
      referencia: p.referencia,
      descripcion: p.nombre,
      tipo: p.tipo,
      cantidad: it.cantidad,
      stock_disponible: stock,
      precio_unitario: aDecimal(precioC),
      subtotal: aDecimal(lineaC),
      es_demo: p.es_demo,
    });
  }

  // Envío: solo se suma si el negocio confirmó el valor. Si no, queda "por confirmar".
  let envioC: number | null = null;
  let envioConfirmado = false;
  if (!opciones.envioAplica) {
    envioC = 0;
    envioConfirmado = true;
  } else if (opciones.costoEnvio !== null) {
    envioC = aCentavos(opciones.costoEnvio);
    envioConfirmado = true;
  }
  return {
    lineas,
    subtotal: aDecimal(subtotalC),
    costo_envio: envioC === null ? null : aDecimal(envioC),
    envio_confirmado: envioConfirmado,
    total: aDecimal(subtotalC + (envioC ?? 0)),
  };
}
