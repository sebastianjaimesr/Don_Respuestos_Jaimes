import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { config } from '../../src/config';
import { pool } from '../../src/db';
import { app, idProducto, reiniciarDatos, tokenCon } from '../helpers';

beforeEach(reiniciarDatos);

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const cliente = { nombre: 'Cliente Ficticio', telefono: '3001234567', ciudad: 'Bogotá' };
const LLAVES = { WOMPI_LLAVE_PUBLICA: 'pub_test_abc123', WOMPI_SECRETO_INTEGRIDAD: 'test_integrity_secreto', WOMPI_SECRETO_EVENTOS: 'test_events_secreto' };
const conWompi = () => Object.assign(config, LLAVES);
afterEach(() => {
  for (const k of Object.keys(LLAVES)) delete (config as Record<string, unknown>)[k];
});

async function pedido(entrega: Record<string, unknown> = { modalidad: 'recogida_tienda' }, metodo_pago = 'transferencia') {
  const c = (await request(app).post('/api/carritos')).body.data;
  await request(app).put(`/api/carritos/${c.id}/items/${await idProducto('DEMO-BJ-XTZ125-OR')}`).send({ cantidad: 2 });
  return request(app).post(`/api/carritos/${c.id}/checkout`).send({ cliente, entrega, metodo_pago, confirmado_por_cliente: true });
}

/** Evento como lo manda Wompi, firmado con el secreto de eventos (o con otro, para probar el rechazo). */
function evento(t: { id: string; reference: string; status: string; amount_in_cents: number }, secreto = LLAVES.WOMPI_SECRETO_EVENTOS) {
  const timestamp = 1730000000;
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const checksum = sha(`${t.id}${t.status}${t.amount_in_cents}${timestamp}${secreto}`);
  return {
    event: 'transaction.updated',
    data: { transaction: { ...t, currency: 'COP', payment_method_type: 'NEQUI' } },
    environment: 'test',
    signature: { properties, checksum },
    timestamp,
    sent_at: '2026-11-08T12:00:00.000Z',
  };
}

describe('envío por ciudad', () => {
  it('usa la tarifa de la ciudad (sin importar tildes) y, si no hay, queda por confirmar', async () => {
    await pool.query(`INSERT INTO tarifas_envio (ciudad, departamento, costo, dias_estimados) VALUES ('Bogotá', 'Cundinamarca', 12000, 2)`);
    const q = await request(app).get('/api/envios/cotizar').query({ ciudad: 'BOGOTA' });
    expect(q.body.data).toMatchObject({ costo: 12000, dias_estimados: 2, fuente: 'tarifa' });
    expect((await request(app).get('/api/envios/cotizar').query({ ciudad: 'Pasto' })).body.data).toMatchObject({ costo: null, fuente: null });

    const r = await pedido({ modalidad: 'envio', ciudad: 'bogotá', direccion: 'Calle 1 # 2-3' });
    expect(r.status).toBe(201);
    expect(r.body.data.pedido).toMatchObject({ costo_envio: '12000.00', envio_confirmado: true, total: '56000.00' });
    const sin = await pedido({ modalidad: 'envio', ciudad: 'Pasto', direccion: 'Calle 1 # 2-3' });
    expect(sin.body.data.pedido).toMatchObject({ envio_confirmado: false, total: '44000.00' });
  });

  it('una tarifa inactiva no se usa; si la ciudad no tiene tarifa vale el costo general confirmado', async () => {
    await pool.query(`INSERT INTO tarifas_envio (ciudad, costo, activo) VALUES ('Cali', 9000, false)`);
    await pool.query(`UPDATE configuracion_negocio SET valor = '15000', confirmado = true WHERE clave = 'costo_envio'`);
    expect((await request(app).get('/api/envios/cotizar').query({ ciudad: 'Cali' })).body.data).toMatchObject({ costo: 15000, fuente: 'configuracion' });
  });
});

describe('pagos en línea', () => {
  it('sin llaves de Wompi no hay pago en línea ni se aceptan eventos', async () => {
    expect((await request(app).get('/api/pagos/opciones')).body.data).toMatchObject({ en_linea: false });
    const r = await pedido();
    const codigo = r.body.data.pedido.codigo;
    expect((await request(app).post(`/api/pedidos/${codigo}/pago-en-linea`).send({ telefono: cliente.telefono })).status).toBe(503);
    expect((await request(app).post('/api/pagos/wompi/eventos').send({})).status).toBe(503);
    const enLinea = await pedido(undefined, 'en_linea');
    expect(enLinea.status).toBe(422);
    expect(enLinea.body.error.codigo).toBe('PAGO_EN_LINEA_NO_DISPONIBLE');
  });

  it('crea el enlace firmado con el saldo y solo un evento firmado confirma el pago', async () => {
    conWompi();
    expect((await request(app).get('/api/pagos/opciones')).body.data).toEqual({ en_linea: true, proveedor: 'wompi', modo_pruebas: true });
    const codigo = (await pedido(undefined, 'en_linea')).body.data.pedido.codigo;
    // Con otro celular no se puede pedir el enlace
    expect((await request(app).post(`/api/pedidos/${codigo}/pago-en-linea`).send({ telefono: '3109999999' })).status).toBe(404);

    const i = await request(app).post(`/api/pedidos/${codigo}/pago-en-linea`).send({ telefono: cliente.telefono });
    expect(i.status).toBe(201);
    const { referencia, monto_centavos, url } = i.body.data;
    expect(monto_centavos).toBe(4400000);
    expect(referencia).toMatch(new RegExp(`^${codigo}-[0-9A-F]{8}$`));
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://checkout.wompi.co/p/');
    expect(u.searchParams.get('public-key')).toBe(LLAVES.WOMPI_LLAVE_PUBLICA);
    expect(u.searchParams.get('signature:integrity')).toBe(sha(`${referencia}4400000COP${LLAVES.WOMPI_SECRETO_INTEGRIDAD}`));
    // El secreto nunca sale en la URL
    expect(url).not.toContain(LLAVES.WOMPI_SECRETO_INTEGRIDAD);
    const estadoPago = async () => (await pool.query('SELECT estado_pago FROM pedidos WHERE codigo = $1', [codigo])).rows[0].estado_pago;
    expect(await estadoPago()).toBe('pendiente');

    // Firma con otro secreto: se rechaza y no cambia nada
    const falso = evento({ id: 'tx-1', reference: referencia, status: 'APPROVED', amount_in_cents: 4400000 }, 'otro_secreto');
    expect((await request(app).post('/api/pagos/wompi/eventos').send(falso)).status).toBe(401);
    // Evento real pero alterado después de firmar (monto cambiado)
    const alterado = evento({ id: 'tx-1', reference: referencia, status: 'APPROVED', amount_in_cents: 4400000 });
    alterado.data.transaction.amount_in_cents = 100;
    expect((await request(app).post('/api/pagos/wompi/eventos').send(alterado)).status).toBe(401);
    expect(await estadoPago()).toBe('pendiente');

    // Firmado pero por un monto distinto al del pago: no se aplica
    const corto = await request(app).post('/api/pagos/wompi/eventos').send(evento({ id: 'tx-0', reference: referencia, status: 'APPROVED', amount_in_cents: 100 }));
    expect(corto.body.data).toMatchObject({ recibido: true, aplicado: false });
    expect(await estadoPago()).toBe('pendiente');

    const bueno = evento({ id: 'tx-1', reference: referencia, status: 'APPROVED', amount_in_cents: 4400000 });
    const ok = await request(app).post('/api/pagos/wompi/eventos').send(bueno);
    expect(ok.body.data).toMatchObject({ recibido: true, aplicado: true });
    expect(await estadoPago()).toBe('confirmado');
    // Wompi reintenta: el mismo evento otra vez no duplica nada
    expect((await request(app).post('/api/pagos/wompi/eventos').send(bueno)).body.data.aplicado).toBe(false);
    // Un evento atrasado "DECLINED" no deshace un pago aprobado
    await request(app).post('/api/pagos/wompi/eventos').send(evento({ id: 'tx-1', reference: referencia, status: 'DECLINED', amount_in_cents: 4400000 }));
    expect(await estadoPago()).toBe('confirmado');

    // El panel ve el pago con la transacción de Wompi; ya pagado no se crea otro enlace
    const t = await tokenCon('admin');
    const pagos = (await request(app).get(`/api/admin/pedidos/${codigo}/pagos`).set('Authorization', `Bearer ${t}`)).body.data;
    expect(pagos[0]).toMatchObject({ proveedor: 'wompi', estado: 'aprobado', metodo: 'nequi', transaccion: 'tx-1', monto: '44000.00' });
    expect((await request(app).post(`/api/pedidos/${codigo}/pago-en-linea`).send({ telefono: cliente.telefono })).body.error.codigo).toBe('PEDIDO_PAGADO');
  });

  it('una transacción no puede pagar dos pedidos, y sin total definitivo no se paga en línea', async () => {
    conWompi();
    const a = (await pedido()).body.data.pedido.codigo;
    const b = (await pedido()).body.data.pedido.codigo;
    const ra = (await request(app).post(`/api/pedidos/${a}/pago-en-linea`).send({ telefono: cliente.telefono })).body.data.referencia;
    const rb = (await request(app).post(`/api/pedidos/${b}/pago-en-linea`).send({ telefono: cliente.telefono })).body.data.referencia;
    await request(app).post('/api/pagos/wompi/eventos').send(evento({ id: 'tx-9', reference: ra, status: 'APPROVED', amount_in_cents: 4400000 }));
    const reusado = await request(app).post('/api/pagos/wompi/eventos').send(evento({ id: 'tx-9', reference: rb, status: 'APPROVED', amount_in_cents: 4400000 }));
    expect(reusado.body.data.aplicado).toBe(false);
    expect((await pool.query('SELECT estado_pago FROM pedidos WHERE codigo = $1', [b])).rows[0].estado_pago).toBe('pendiente');

    const porConfirmar = (await pedido({ modalidad: 'envio', ciudad: 'Pasto', direccion: 'Calle 1 # 2-3' })).body.data.pedido.codigo;
    const r = await request(app).post(`/api/pedidos/${porConfirmar}/pago-en-linea`).send({ telefono: cliente.telefono });
    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('TOTAL_POR_CONFIRMAR');
  });
});
