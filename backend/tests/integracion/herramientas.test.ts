import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../../src/db';
import { buscarRepuesto } from '../../src/modulos/catalogo/servicio';
import { crearCotizacion } from '../../src/modulos/cotizaciones/servicio';
import { registrarPedido } from '../../src/modulos/pedidos/servicio';
import { app, idProducto, pedidoBase, reiniciarDatos, stock, tokenCon } from '../helpers';

beforeEach(reiniciarDatos);

describe('buscar_repuesto(modelo, año, repuesto)', () => {
  it('[1] encuentra un repuesto existente con datos estructurados', async () => {
    const r = await buscarRepuesto({ modelo: 'FZ 2.0', anio: 2018, repuesto: 'pastillas de freno', posicion: 'delantero' });
    expect(r.estado).toBe('ok');
    expect(r.resultados).toHaveLength(2);
    expect(r.resultados[0]).toMatchObject({
      referencia: 'DEMO-PF-FZ2-D-OR',
      precio: '68000.00',
      precio_confirmado: true,
      tipo: 'original',
      disponibilidad: { cantidad: 5, estado: 'disponible' },
      advertencia_seguridad: true,
      es_demo: true,
    });
  });

  it('[2] búsqueda sin resultados', async () => {
    const r = await buscarRepuesto({ modelo: 'NMAX', anio: 2020, repuesto: 'bujía' });
    expect(r.estado).toBe('sin_resultados');
    expect(r.resultados).toEqual([]);
  });

  it('[3] compatibilidad confirmada incluye modelo, rango de años y fuente', async () => {
    const r = await buscarRepuesto({ modelo: 'YBR 125', anio: 2015, repuesto: 'kit de arrastre' });
    expect(r.resultados[0].compatibilidad).toMatchObject({ modelo: 'YBR 125', anio_desde: 2010, anio_hasta: 2024, verificada: true });
    expect(r.resultados[0].compatibilidad.fuente).toBeTruthy();
  });

  it('[3b] compatibilidad NO verificada se marca como tal (no es coincidencia garantizada)', async () => {
    const r = await buscarRepuesto({ modelo: 'R15', anio: 2019, repuesto: 'bujia' });
    expect(r.resultados[0].compatibilidad.verificada).toBe(false);
  });

  it('[4] incompatibilidad entre modelo y año: no se ofrece como compatible', async () => {
    const r = await buscarRepuesto({ modelo: 'XTZ 125', anio: 2023, repuesto: 'bujia' });
    expect(r.estado).toBe('anio_no_compatible');
    expect(r.resultados).toHaveLength(0);
    expect(r.fuera_de_rango[0].compatibilidad).toMatchObject({ anio_desde: 2015, anio_hasta: 2020 });
  });

  it('[4b] modelos con nombre parecido no comparten repuestos (FZ 25 ≠ FZ 2.0)', async () => {
    const r = await buscarRepuesto({ modelo: 'FZ 25', anio: 2018, repuesto: 'pastillas', posicion: 'delantero' });
    expect(r.estado).toBe('sin_resultados');
    const amb = await buscarRepuesto({ modelo: 'fz', anio: 2018, repuesto: 'pastillas' });
    expect(amb.estado).toBe('modelo_ambiguo');
  });

  it('[5] distingue original y genérico, y filtra por tipo', async () => {
    const todos = await buscarRepuesto({ modelo: 'FZ 2.0', anio: 2018, repuesto: 'pastillas', posicion: 'delantero' });
    expect(todos.resultados.map((p) => p.tipo)).toEqual(['original', 'generico']);
    const gen = await buscarRepuesto({ modelo: 'FZ 2.0', anio: 2018, repuesto: 'pastillas', posicion: 'delantero', tipo: 'generico' });
    expect(gen.resultados.map((p) => p.referencia)).toEqual(['DEMO-PF-FZ2-D-GN']);
  });

  it('[5b] la base de datos impide mezclar un producto genérico con una marca original', async () => {
    const yamaha = (await pool.query(`SELECT id FROM marcas WHERE nombre = 'Yamaha'`)).rows[0].id;
    await expect(
      pool.query(`INSERT INTO productos (referencia, nombre, categoria, marca_id, tipo, precio) VALUES ('X-1', 'X', 'bujia', $1, 'generico', 1000)`, [yamaha]),
    ).rejects.toThrow(/fk_productos_marca_tipo/);
  });

  it('[6] producto agotado: se informa el estado y el tiempo de abastecimiento', async () => {
    const r = await buscarRepuesto({ modelo: 'FZ 2.0', anio: 2018, repuesto: 'filtro de aceite' });
    expect(r.resultados[0].disponibilidad).toEqual({ cantidad: 0, estado: 'agotado', tiempo_abastecimiento_dias: 5 });
    await expect(registrarPedido(pedidoBase([{ producto_id: await idProducto('DEMO-FA-FZ2-OR'), cantidad: 1 }]))).rejects.toMatchObject({ codigo: 'STOCK_INSUFICIENTE' });
  });

  it('[7] precio faltante: no se inventa ni se puede cotizar', async () => {
    const r = await buscarRepuesto({ modelo: 'NMAX', anio: 2020, repuesto: 'filtro de aire' });
    expect(r.resultados[0]).toMatchObject({ precio: null, precio_confirmado: false });
    await expect(crearCotizacion({ items: [{ producto_id: await idProducto('DEMO-FAI-NMX-OR'), cantidad: 1 }] })).rejects.toMatchObject({
      codigo: 'PRECIO_NO_CONFIRMADO',
    });
  });

  it('valida el año en el endpoint HTTP', async () => {
    const r = await request(app).get('/api/repuestos/buscar').query({ modelo: 'NMAX', anio: 1800, repuesto: 'bujia' });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });
});

describe('cotizaciones', () => {
  it('[9][10] cotización con varios productos y totales calculados en servidor', async () => {
    const c = await crearCotizacion({
      items: [
        { producto_id: await idProducto('DEMO-PF-FZ2-D-OR'), cantidad: 2 },
        { producto_id: await idProducto('DEMO-AC-20W50-OR'), cantidad: 1 },
        { producto_id: await idProducto('DEMO-PF-FZ2-D-OR'), cantidad: 1 }, // repetido: se consolida
      ],
      modalidad_entrega: 'envio',
      ciudad: 'Cúcuta',
    });
    expect(c.codigo).toMatch(/^COT-\d{6}$/);
    expect(c.lineas).toHaveLength(2);
    const pastillas = c.lineas.find((l) => l.referencia === 'DEMO-PF-FZ2-D-OR')!;
    expect(pastillas).toMatchObject({ cantidad: 3, precio_unitario: '68000.00', subtotal: '204000.00' });
    expect(c.subtotal).toBe('239000.00'); // 3 x 68.000 + 35.000
    // Envío no confirmado por el negocio → no se suma ni se presenta como definitivo
    expect(c.costo_envio).toBeNull();
    expect(c.envio_confirmado).toBe(false);
    expect(c.total).toBe('239000.00');
    const db = (await pool.query('SELECT subtotal, total, estado FROM cotizaciones WHERE codigo = $1', [c.codigo])).rows[0];
    expect(db).toEqual({ subtotal: '239000.00', total: '239000.00', estado: 'emitida' });
  });

  it('[10b] suma el envío solo cuando el negocio lo confirmó', async () => {
    await pool.query(`UPDATE configuracion_negocio SET valor = '12000', confirmado = true WHERE clave = 'costo_envio'`);
    const c = await crearCotizacion({ items: [{ producto_id: await idProducto('DEMO-BB-CRY-GN'), cantidad: 3 }], modalidad_entrega: 'envio' });
    expect(c).toMatchObject({ subtotal: '27000.00', costo_envio: '12000.00', envio_confirmado: true, total: '39000.00' });
  });
});

describe('registrar_pedido(cliente, items, entrega)', () => {
  it('[8] inventario insuficiente', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    await expect(registrarPedido(pedidoBase([{ producto_id: id, cantidad: 6 }]))).rejects.toMatchObject({
      codigo: 'STOCK_INSUFICIENTE',
      detalles: { disponible: 5, solicitado: 6 },
    });
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(5);
  });

  it('[11] pedido sin confirmación del cliente es rechazado', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    await expect(registrarPedido(pedidoBase([{ producto_id: id, cantidad: 1 }], { confirmado_por_cliente: false }))).rejects.toMatchObject({
      codigo: 'CONFIRMACION_REQUERIDA',
    });
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM pedidos')).rows[0].n).toBe(0);
  });

  it('[11b] cantidades negativas o cero son rechazadas', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    await expect(registrarPedido(pedidoBase([{ producto_id: id, cantidad: -2 }]))).rejects.toThrow();
    await expect(registrarPedido(pedidoBase([{ producto_id: id, cantidad: 0 }]))).rejects.toThrow();
  });

  it('[12] pedido confirmado: se registra, descuenta stock, deja movimiento y es idempotente', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    const entrada = pedidoBase([{ producto_id: id, cantidad: 2 }], {
      entrega: { modalidad: 'envio', ciudad: 'Medellín', direccion: 'Carrera 70 # 44-10' },
      metodo_pago: 'nequi',
      clave_idempotencia: 'clave-fija-123',
    });
    const p = await registrarPedido(entrada);
    expect(p).toMatchObject({ codigo: 'PED-000001', estado: 'registrado', subtotal: '136000.00', total: '136000.00', envio_confirmado: false, idempotente: false });
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(3);
    const mov = (await pool.query(`SELECT tipo, cantidad, cantidad_anterior, cantidad_nueva FROM movimientos_inventario WHERE pedido_id = $1`, [p.id])).rows;
    expect(mov).toEqual([{ tipo: 'venta', cantidad: -2, cantidad_anterior: 5, cantidad_nueva: 3 }]);

    // Reintento con la misma clave (doble clic, reintento de n8n): mismo pedido, sin descontar de nuevo
    const otra = await registrarPedido(entrada);
    expect(otra).toMatchObject({ codigo: 'PED-000001', idempotente: true });
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(3);
  });

  it('[12b] el cliente no se duplica si vuelve a comprar con el mismo teléfono', async () => {
    const id = await idProducto('DEMO-AC-20W50-OR');
    await registrarPedido(pedidoBase([{ producto_id: id, cantidad: 1 }], { cliente: { nombre: 'Ana', telefono: '+57 310 000 0000', ciudad: 'Cali' } }));
    await registrarPedido(pedidoBase([{ producto_id: id, cantidad: 1 }], { cliente: { nombre: 'Ana María', telefono: '3100000000', ciudad: 'Cali' } }));
    const c = (await pool.query('SELECT nombre FROM clientes')).rows;
    expect(c).toEqual([{ nombre: 'Ana María' }]);
  });

  it('[16] dos pedidos simultáneos por la última unidad: solo uno se registra', async () => {
    const id = await idProducto('DEMO-KA-YBR-GN'); // stock = 1
    const resultados = await Promise.allSettled([
      registrarPedido(pedidoBase([{ producto_id: id, cantidad: 1 }], { cliente: { nombre: 'Uno', telefono: '3001111111', ciudad: 'Tunja' } })),
      registrarPedido(pedidoBase([{ producto_id: id, cantidad: 1 }], { cliente: { nombre: 'Dos', telefono: '3002222222', ciudad: 'Tunja' } })),
    ]);
    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const fallos = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(exitos).toHaveLength(1);
    expect(fallos).toHaveLength(1);
    expect(fallos[0].reason).toMatchObject({ codigo: 'STOCK_INSUFICIENTE' });
    expect(await stock('DEMO-KA-YBR-GN')).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM pedidos')).rows[0].n).toBe(1);
  });

  it('[16b] muchas compras simultáneas nunca dejan el inventario negativo', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-GN'); // stock = 3
    const intentos = Array.from({ length: 8 }, (_, i) =>
      registrarPedido(pedidoBase([{ producto_id: id, cantidad: 1 }], { cliente: { nombre: `C${i}`, telefono: `30000000${10 + i}`, ciudad: 'Pasto' } })),
    );
    const r = await Promise.allSettled(intentos);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    expect(await stock('DEMO-PF-FZ2-D-GN')).toBe(0);
  });

  it('cancelar un pedido devuelve las unidades al inventario', async () => {
    const id = await idProducto('DEMO-PF-FZ2-T-OR');
    const p = await registrarPedido(pedidoBase([{ producto_id: id, cantidad: 2 }]));
    expect(await stock('DEMO-PF-FZ2-T-OR')).toBe(2);
    const token = await tokenCon('vendedor');
    const r = await request(app).patch(`/api/admin/pedidos/${p.codigo}`).set('Authorization', `Bearer ${token}`).send({ estado: 'cancelado' });
    expect(r.status).toBe(200);
    expect(await stock('DEMO-PF-FZ2-T-OR')).toBe(4);
    const r2 = await request(app).patch(`/api/admin/pedidos/${p.codigo}`).set('Authorization', `Bearer ${token}`).send({ estado: 'enviado' });
    expect(r2.status).toBe(409);
  });

  it('seguimiento público exige código + teléfono correctos', async () => {
    const p = await registrarPedido(pedidoBase([{ producto_id: await idProducto('DEMO-BB-CRY-GN'), cantidad: 1 }]));
    const ok = await request(app).get('/api/pedidos/seguimiento').query({ codigo: p.codigo, telefono: '300 123 4567' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).not.toHaveProperty('direccion_entrega');
    const mal = await request(app).get('/api/pedidos/seguimiento').query({ codigo: p.codigo, telefono: '3009999999' });
    expect(mal.status).toBe(404);
  });
});
