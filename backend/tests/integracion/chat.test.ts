import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db';
import { DESPEDIDA } from '../../src/asistente/motor';
import { nuevoChat, reiniciarDatos, stock } from '../helpers';

beforeEach(reiniciarDatos);

const textos = (r: { respuestas: { texto: string }[] }) => r.respuestas.map((x) => x.texto).join('\n');

describe('asistente conversacional', () => {
  it('saluda con el mensaje definido y pide los datos que faltan, uno o dos a la vez', async () => {
    const { enviar } = await nuevoChat();
    expect(textos(await enviar('necesito pastillas de freno'))).toMatch(/modelo y el año/);
    expect(textos(await enviar('NMAX'))).toMatch(/De qué año es tu NMAX/);
    expect(textos(await enviar('2020'))).toMatch(/delanteras o traseras/);
  });

  it('pregunta cuál moto cuando el nombre es ambiguo y aclara el repuesto impreciso', async () => {
    const { enviar } = await nuevoChat();
    const r = await enviar('un filtro para la fz 2019');
    expect(textos(r)).toMatch(/FZ 2\.0[\s\S]*FZ 25/);
    expect(textos(await enviar('la 1'))).toMatch(/filtro de aire o el filtro de aceite/);
    const res = await enviar('aceite');
    expect(res.respuestas[0].tipo).toBe('productos');
    expect(textos(res)).toMatch(/DEMO-FA-FZ2-OR/);
  });

  it('[1][5] muestra opciones original y genérica solo con campos confirmados y la advertencia de seguridad', async () => {
    const { enviar } = await nuevoChat();
    const r = await enviar('pastillas delanteras para fz 2.0 2018');
    const t = textos(r);
    expect(t).toMatch(/Encontré 2 opciones/);
    expect(t).toMatch(/Original Yamaha/);
    expect(t).toMatch(/Genérico/);
    expect(t).toMatch(/\$68\.000/);
    expect(t).toMatch(/compatibilidad confirmada antes de instalarlo/);
    expect(t).toMatch(/datos de demostración ficticios/);
  });

  it('[4] incompatibilidad de año: no ofrece el producto y propone un asesor', async () => {
    const { enviar } = await nuevoChat();
    const r = await enviar('bujía para xtz 125 2023');
    expect(textos(r)).toMatch(/no está confirmada la compatibilidad/);
    expect(r.respuestas[0].acciones?.some((a) => a.accion.tipo === 'agregar')).toBe(false);
  });

  it('[6][7] agotado y precio faltante: se informan y no se pueden agregar', async () => {
    const a = await nuevoChat();
    const ag = await a.enviar('filtro de aceite fz 2.0 2018');
    expect(textos(ag)).toMatch(/agotado \(abastecimiento estimado: 5 días\)/);
    expect(textos(await a.enviar('sí, agrégalo'))).toMatch(/no la puedo agregar porque está agotado|asesor/);

    const b = await nuevoChat();
    const pr = await b.enviar('filtro de aire nmax 2021');
    expect(textos(pr)).toMatch(/Precio: por confirmar con un asesor/);
    expect(textos(pr)).not.toMatch(/\$\d/);
    expect(textos(await b.enviar('la 1'))).toMatch(/precio todavía no está confirmado/);
  });

  it('[11][12] flujo completo: no registra hasta la confirmación explícita y luego sí', async () => {
    const { enviar, id } = await nuevoChat();
    await enviar('pastillas traseras fz 2.0 2018');
    expect(textos(await enviar('sí, 2 unidades'))).toMatch(/agregué .* x2/);
    await enviar('quiero hacer el pedido');
    for (const m of ['Laura Gómez', '3159876543', 'Pereira', 'recoger en tienda']) await enviar(m);
    const resumen = await enviar('daviplata');
    expect(resumen.respuestas[0].tipo).toBe('resumen_pedido');
    expect(textos(resumen)).toMatch(/Total: \$118\.000/);
    // [11] Aún no hay pedido: falta confirmación
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM pedidos')).rows[0].n).toBe(0);
    expect(textos(await enviar('mmm déjame ver'))).toMatch(/responde SÍ/i);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM pedidos')).rows[0].n).toBe(0);

    const fin = await enviar('sí, confirmo');
    expect(fin.respuestas[0].tipo).toBe('pedido_registrado');
    expect(textos(fin)).toMatch(/PED-000001/);
    const p = (await pool.query('SELECT total, metodo_pago, modalidad_entrega, conversacion_id FROM pedidos')).rows[0];
    expect(p).toEqual({ total: '118000.00', metodo_pago: 'daviplata', modalidad_entrega: 'recogida_tienda', conversacion_id: id });
    expect(await stock('DEMO-PF-FZ2-T-OR')).toBe(2);
  });

  it('[12b] el botón "confirmar" repetido no duplica el pedido', async () => {
    const { enviar } = await nuevoChat();
    await enviar('aceite para ybr 125 2015');
    await enviar('agregar');
    await enviar({ accion: { tipo: 'iniciar_pedido' } });
    await enviar({ accion: { tipo: 'datos_entrega', datos: { nombre: 'Pedro', telefono: '3001112233', ciudad: 'Neiva', modalidad: 'recogida_tienda', metodo_pago: 'efectivo' } } });
    const r1 = await enviar({ accion: { tipo: 'confirmar_pedido' } });
    expect(r1.respuestas[0].tipo).toBe('pedido_registrado');
    const r2 = await enviar({ accion: { tipo: 'confirmar_pedido' } });
    expect(r2.respuestas[0].tipo).not.toBe('pedido_registrado');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM pedidos')).rows[0].n).toBe(1);
  });

  it('[14] solicitud de atención humana: registra, cambia el estado y es honesto sobre la notificación', async () => {
    const { enviar, id } = await nuevoChat();
    const r = await enviar('quiero hablar con un asesor');
    expect(r.respuestas[0].tipo).toBe('escalado');
    expect(r.estado).toBe('escalada');
    // No hay receptor en el puerto configurado → no se afirma que se notificó
    expect(textos(r)).toMatch(/quedó registrada/);
    expect(textos(r)).not.toMatch(/minutos|enseguida|inmediato/);
    const t = (await pool.query('SELECT motivo, estado, notificado FROM transferencias_atencion WHERE conversacion_id = $1', [id])).rows;
    expect(t).toEqual([{ motivo: 'solicitud_cliente', estado: 'pendiente', notificado: false }]);
    // Pedirlo de nuevo no duplica la solicitud
    await enviar('asesor por favor');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM transferencias_atencion')).rows[0].n).toBe(1);
  });

  it('[14b] cliente molesto se escala con motivo propio', async () => {
    const { enviar } = await nuevoChat();
    const r = await enviar('esto es un pésimo servicio');
    expect(textos(r)).toMatch(/Lamento mucho la molestia/);
    expect((await pool.query('SELECT motivo FROM transferencias_atencion')).rows[0].motivo).toBe('cliente_molesto');
  });

  it('redirige temas ajenos, despide con el mensaje definido y protege datos de tarjeta', async () => {
    const { enviar, id } = await nuevoChat();
    expect(textos(await enviar('cuéntame un chiste de fútbol'))).toMatch(/repuestos para motos Yamaha/);
    expect(textos(await enviar('chao'))).toBe(DESPEDIDA);
    expect(textos(await enviar('mi tarjeta es 4111 1111 1111 1111'))).toMatch(/no compartas números de tarjeta/);
    const guardado = (await pool.query(`SELECT contenido FROM mensajes WHERE conversacion_id = $1 AND contenido LIKE '%4111%'`, [id])).rows;
    expect(guardado).toHaveLength(0);
  });
});
