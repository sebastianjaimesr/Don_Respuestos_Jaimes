import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { pool } from '../../src/db';
import { registrarPedido } from '../../src/modulos/pedidos/servicio';
import { leerDinero } from '../../src/modulos/datos/importacion';
import { leerCsv } from '../../src/modulos/datos/archivos';
import { Supabase } from '../../src/modulos/imagenes/almacenamiento';
import { app, idProducto, pedidoBase, reiniciarDatos, stock, tokenCon } from '../helpers';

beforeEach(reiniciarDatos);

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const precioDe = async (sku: string) => (await pool.query('SELECT precio FROM productos WHERE sku = $1', [sku])).rows[0]?.precio as string | null;
const hace = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const en = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function subir(t: string, tipo: string, archivo: string, cuerpo: Buffer | string) {
  return request(app)
    .post('/api/admin/importaciones')
    .query({ tipo, archivo })
    .set(auth(t))
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'utf8'));
}

async function xlsx(encabezados: string[], filas: (string | number | null)[][]) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Hoja1');
  hoja.addRow(encabezados);
  filas.forEach((f) => hoja.addRow(f));
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Descarga binaria con supertest. */
const binario = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const partes: Buffer[] = [];
    res.on('data', (c: Buffer) => partes.push(c));
    res.on('end', () => cb(null, Buffer.concat(partes)));
  });

describe('lectura de valores de hojas de cálculo', () => {
  it('entiende los formatos de dinero colombianos sin confundir miles con decimales', () => {
    expect(leerDinero('15.000', 'precio')).toBe(15000);
    expect(leerDinero('$ 1.234.567,50', 'precio')).toBe(1234567.5);
    expect(leerDinero('15000,5', 'precio')).toBe(15000.5);
    expect(() => leerDinero(1.125, 'precio')).toThrow(/dos decimales/); // número real de Excel: no es "1125"
    expect(() => leerDinero('quince mil', 'precio')).toThrow();
  });

  it('el CSV acepta ";" y comillas con saltos de línea', () => {
    expect(leerCsv('﻿sku;nombre\r\nA-1;"Bujía; ""iridio""\nlarga"\r\n')).toEqual([
      ['sku', 'nombre'],
      ['A-1', 'Bujía; "iridio"\nlarga'],
    ]);
  });
});

describe('promociones', () => {
  it('el precio con promoción es el mismo en catálogo, carrito y pedido', async () => {
    const t = await tokenCon('admin');
    const p = await request(app)
      .post('/api/admin/promociones')
      .set(auth(t))
      .send({ nombre: 'Semana de bujías (prueba)', tipo_descuento: 'porcentaje', valor: 10, alcance: 'categoria', categoria: 'bujia', inicia_at: hace(1), termina_at: en(24) });
    expect(p.status).toBe(201);
    expect(p.body.data).toMatchObject({ estado: 'vigente', productos_con_esta_promocion: 2 });

    const cat = await request(app).get('/api/catalogo/productos').query({ categoria: 'bujia', orden: 'precio_asc' });
    const r15 = cat.body.data.items.find((x: { sku: string }) => x.sku === 'DEMO-BJ-R15-GN');
    expect(r15).toMatchObject({ precio: '13500.00', promocion: { nombre: 'Semana de bujías (prueba)', precio_antes: '15000.00' } });

    const c = (await request(app).post('/api/carritos')).body.data;
    await request(app).put(`/api/carritos/${c.id}/items/${r15.id}`).send({ cantidad: 2 });
    const carrito = await request(app).get(`/api/carritos/${c.id}`);
    expect(carrito.body.data).toMatchObject({ subtotal: '27000.00' });

    const pedido = await registrarPedido(pedidoBase([{ producto_id: r15.id, cantidad: 1 }]));
    expect(pedido.lineas[0].precio_unitario).toBe('13500.00');
    // El precio de lista no cambió
    expect(await precioDe('DEMO-BJ-R15-GN')).toBe('15000.00');
  });

  it('gana el mayor descuento, no se suman, y no aplica fuera de fechas ni si deja el precio en 0', async () => {
    const t = await tokenCon('admin');
    const id = await idProducto('DEMO-BB-CRY-GN'); // $9.000
    const crear = (b: Record<string, unknown>) =>
      request(app).post('/api/admin/promociones').set(auth(t)).send({ nombre: 'Promo prueba', alcance: 'producto', producto_id: id, inicia_at: hace(1), termina_at: en(1), ...b });
    await crear({ tipo_descuento: 'valor', valor: 1000 });
    await crear({ tipo_descuento: 'porcentaje', valor: 20 }); // 7.200: mejor
    await crear({ tipo_descuento: 'valor', valor: 9000 }); // dejaría 0: se ignora
    await crear({ tipo_descuento: 'porcentaje', valor: 50, inicia_at: en(2), termina_at: en(5) }); // programada
    const { rows } = await pool.query('SELECT precio, precio_lista FROM v_precio_vigente WHERE producto_id = $1', [id]);
    expect(rows[0]).toEqual({ precio: '7200.00', precio_lista: '9000.00' });
    // Un producto sin precio confirmado no recibe precio por una promoción
    const sinPrecio = await idProducto('DEMO-FAI-NMX-OR');
    await crear({ producto_id: sinPrecio, tipo_descuento: 'valor', valor: 1000 });
    expect((await pool.query('SELECT precio FROM v_precio_vigente WHERE producto_id = $1', [sinPrecio])).rows[0].precio).toBeNull();
  });

  it('crear promociones exige permiso de precios', async () => {
    const t = await tokenCon('vendedor');
    const r = await request(app)
      .post('/api/admin/promociones')
      .set(auth(t))
      .send({ nombre: 'No permitida', tipo_descuento: 'valor', valor: 1000, alcance: 'marca', marca_id: 1, inicia_at: hace(1), termina_at: en(1) });
    expect(r.status).toBe(403);
  });
});

describe('importación de productos (CSV)', () => {
  const marcaGen = 'Genérica Demo A';
  const csv = [
    'SKU;Nombre;Categoría;Marca;Tipo;Precio;Precio compra;Stock mínimo',
    `DEMO-BJ-R15-GN;Bujía genérica;bujia;${marcaGen};generico;16.500;9.000;3`, // actualiza precio
    `DEMO-NUEVO-IMP-1;Bombillo LED;bombillo;${marcaGen};;$ 12.000;;`, // crea
    `DEMO-NUEVO-IMP-2;Producto X;frenos;${marcaGen};;1000;;`, // grupo, no categoría
    `DEMO-NUEVO-IMP-3;Producto Y;bujia;Marca Inexistente;;1000;;`,
    `DEMO-NUEVO-IMP-4;Producto Z;bujia;${marcaGen};original;1000;;`, // original sin ser marca del fabricante
    `DEMO-NUEVO-IMP-1;Repetido;bombillo;${marcaGen};;1000;;`,
  ].join('\r\n');

  it('valida en seco con errores por fila y no cambia nada', async () => {
    const t = await tokenCon('admin');
    const r = await subir(t, 'productos', 'catalogo.csv', csv);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ estado: 'con_errores', formato: 'csv', filas_total: 6, filas_validas: 2, filas_error: 4, resumen: { crear: 1, actualizar: 1 } });
    const porFila = Object.fromEntries(r.body.data.errores.map((e: { fila: number; columna: string }) => [e.fila, e.columna]));
    expect(porFila).toEqual({ 4: 'categoria', 5: 'marca', 6: 'tipo', 7: 'sku' });
    expect(await precioDe('DEMO-BJ-R15-GN')).toBe('15000.00');
    expect(await precioDe('DEMO-NUEVO-IMP-1')).toBeUndefined();

    const errores = await request(app).get(`/api/admin/importaciones/${r.body.data.id}/errores.csv`).set(auth(t));
    expect(errores.headers['content-type']).toMatch(/text\/csv/);
    expect(errores.text).toContain('Repetido: ya aparece en la fila 3');
  });

  it('"todo o nada" no aplica nada si hay errores; "solo válidas" aplica y deja historial', async () => {
    const t = await tokenCon('admin');
    const id = (await subir(t, 'productos', 'catalogo.csv', csv)).body.data.id;
    const todo = await request(app).post(`/api/admin/importaciones/${id}/aplicar`).set(auth(t)).send({ modo: 'todo_o_nada' });
    expect(todo.status).toBe(409);
    expect(await precioDe('DEMO-BJ-R15-GN')).toBe('15000.00');

    const ap = await request(app).post(`/api/admin/importaciones/${id}/aplicar`).set(auth(t)).send({ modo: 'solo_validas' });
    expect(ap.status).toBe(200);
    expect(ap.body.data).toMatchObject({ estado: 'aplicada', aplicadas: 2 });
    expect(await precioDe('DEMO-BJ-R15-GN')).toBe('16500.00');
    expect(await precioDe('DEMO-NUEVO-IMP-1')).toBe('12000.00');
    expect(await stock('DEMO-NUEVO-IMP-1')).toBe(0);
    const h = await pool.query(`SELECT origen FROM historial_precios WHERE producto_id = $1 ORDER BY id DESC LIMIT 1`, [await idProducto('DEMO-BJ-R15-GN')]);
    expect(h.rows[0].origen).toBe('importacion');
    // Una importación aplicada no se aplica dos veces
    expect((await request(app).post(`/api/admin/importaciones/${id}/aplicar`).set(auth(t)).send({ modo: 'solo_validas' })).status).toBe(409);
  });

  it('pide las columnas obligatorias y solo acepta CSV o XLSX', async () => {
    const t = await tokenCon('admin');
    const r = await subir(t, 'productos', 'x.csv', 'sku;nombre\nA;B\n');
    expect(r.body.error).toMatchObject({ codigo: 'COLUMNAS_FALTANTES' });
    expect((await subir(t, 'productos', 'x.xls', 'algo')).body.error.codigo).toBe('FORMATO_NO_SOPORTADO');
    expect((await subir(t, 'productos', 'x.xlsx', 'no soy un zip')).body.error.codigo).toBe('ARCHIVO_INVALIDO');
  });

  it('el vendedor no puede importar', async () => {
    const t = await tokenCon('vendedor');
    expect((await subir(t, 'stock', 'conteo.csv', 'sku;cantidad;motivo\nDEMO-BJ-R15-GN;5;Conteo')).status).toBe(403);
  });
});

describe('importación de stock y compatibilidades (Excel)', () => {
  it('el stock contado queda como ajuste con movimiento auditado', async () => {
    const t = await tokenCon('admin');
    const archivo = await xlsx(['sku', 'cantidad', 'diferencia', 'motivo'], [
      ['DEMO-BJ-R15-GN', 20, null, 'Conteo físico'],
      ['DEMO-KA-YBR-GN', null, 3, 'Llegó sin factura'],
      ['DEMO-NO-EXISTE', 1, null, 'Conteo'],
    ]);
    const v = await subir(t, 'stock', 'conteo.xlsx', archivo);
    expect(v.body.data).toMatchObject({ formato: 'xlsx', filas_validas: 2, filas_error: 1 });
    await request(app).post(`/api/admin/importaciones/${v.body.data.id}/aplicar`).set(auth(t)).send({ modo: 'solo_validas' });
    expect(await stock('DEMO-BJ-R15-GN')).toBe(20);
    expect(await stock('DEMO-KA-YBR-GN')).toBe(4);
    const m = await pool.query(`SELECT tipo, motivo FROM movimientos_inventario WHERE producto_id = $1 ORDER BY id DESC LIMIT 1`, [await idProducto('DEMO-BJ-R15-GN')]);
    expect(m.rows[0]).toEqual({ tipo: 'ajuste', motivo: `Importación #${v.body.data.id}: Conteo físico` });
  });

  it('una compatibilidad verificada exige fuente', async () => {
    const t = await tokenCon('admin');
    const modelo = (await pool.query(`SELECT mo.nombre, f.nombre AS fabricante FROM modelos_motocicleta mo JOIN fabricantes_moto f ON f.id = mo.fabricante_id WHERE mo.nombre = 'CB 190R'`)).rows[0];
    const archivo = await xlsx(['sku', 'fabricante', 'modelo', 'año desde', 'año hasta', 'verificada', 'fuente'], [
      ['DEMO-BJ-R15-GN', modelo.fabricante, modelo.nombre, 2016, 2022, 'sí', 'Catálogo del proveedor'],
      ['DEMO-BJ-XTZ125-OR', modelo.fabricante, modelo.nombre, 2016, 2022, 'sí', null],
      ['DEMO-BJ-XTZ125-OR', modelo.fabricante, 'Moto que no existe', 2016, 2022, 'no', null],
    ]);
    const v = await subir(t, 'compatibilidades', 'compat.xlsx', archivo);
    expect(v.body.data.errores.map((e: { fila: number; columna: string }) => [e.fila, e.columna])).toEqual([
      [3, 'fuente'],
      [4, 'modelo'],
    ]);
    await request(app).post(`/api/admin/importaciones/${v.body.data.id}/aplicar`).set(auth(t)).send({ modo: 'solo_validas' });
    const c = await pool.query(`SELECT verificada, fuente FROM compatibilidades c JOIN productos p ON p.id = c.producto_id WHERE p.sku = 'DEMO-BJ-R15-GN' AND anio_desde = 2016`);
    expect(c.rows[0]).toEqual({ verificada: true, fuente: 'Catálogo del proveedor' });
  });
});

describe('exportación', () => {
  it('el Excel exportado se puede volver a importar sin errores', async () => {
    const t = await tokenCon('admin');
    const r = await binario(request(app).get('/api/admin/exportaciones/inventario').query({ formato: 'xlsx' }).set(auth(t)));
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/inventario-\d{4}-\d{2}-\d{2}\.xlsx/);
    const v = await subir(t, 'productos', 'inventario.xlsx', r.body as Buffer);
    const total = Number((await pool.query('SELECT COUNT(*) FROM productos')).rows[0].count);
    expect(v.body.data).toMatchObject({ estado: 'validada', filas_total: total, filas_error: 0, resumen: { crear: 0, actualizar: total } });
    expect(v.body.data.resumen.columnas_ignoradas).toEqual(['stock_actual', 'estado_stock', 'es_demo']);
  });

  it('el CSV neutraliza textos que Excel abriría como fórmula', async () => {
    const t = await tokenCon('admin');
    await pool.query(`UPDATE productos SET descripcion = '=HYPERLINK("http://malo")' WHERE sku = 'DEMO-BJ-R15-GN'`);
    const r = await request(app).get('/api/admin/exportaciones/inventario').query({ formato: 'csv' }).set(auth(t));
    expect(r.text).toContain(`"'=HYPERLINK(""http://malo"")"`);
    expect(r.text.startsWith('﻿sku;nombre;categoria;marca')).toBe(true);
  });

  it('las plantillas se descargan con una fila de ejemplo', async () => {
    const t = await tokenCon('consulta');
    const r = await request(app).get('/api/admin/importaciones/plantillas/stock').query({ formato: 'csv' }).set(auth(t));
    expect(r.text).toContain('sku;motivo;cantidad;diferencia');
    expect((await request(app).get('/api/admin/exportaciones/inventario').set(auth(t))).status).toBe(403);
  });
});

describe('imágenes de productos', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);

  async function subirImagen(t: string, productoId: number, contenido: Buffer, tipo = 'image/png') {
    const f = await request(app).post(`/api/admin/productos/${productoId}/imagenes/firma`).set(auth(t)).send({ tipo, bytes: contenido.length });
    expect(f.status).toBe(201);
    const url = new URL(f.body.data.subida.url, 'http://local');
    const put = await request(app).put(url.pathname).set('Content-Type', tipo).send(contenido);
    expect(put.status).toBe(200);
    return { clave: f.body.data.clave as string, registro: await request(app).post(`/api/admin/productos/${productoId}/imagenes`).set(auth(t)).send({ clave: f.body.data.clave, alt: 'Foto' }) };
  }

  it('sube, verifica el contenido, publica en la tienda y borra', async () => {
    const t = await tokenCon('admin');
    const id = await idProducto('DEMO-BJ-R15-GN');
    const { registro } = await subirImagen(t, id, PNG);
    expect(registro.status).toBe(201);
    expect(registro.body.data[0]).toMatchObject({ es_principal: true, alt: 'Foto' });
    const url = registro.body.data[0].url as string;
    expect(url).toMatch(/^\/api\/almacen-local\/archivos\/productos\/\d+\/.+\.png$/);
    const archivo = await request(app).get(url);
    expect(archivo.status).toBe(200);
    expect(archivo.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const slug = (await pool.query('SELECT slug FROM productos WHERE id = $1', [id])).rows[0].slug;
    expect((await request(app).get(`/api/catalogo/productos/${slug}`)).body.data.imagenes[0].url).toBe(url);

    const borrar = await request(app).delete(`/api/admin/imagenes/${registro.body.data[0].id}`).set(auth(t));
    expect(borrar.body.data).toEqual([]);
    expect((await request(app).get(url)).status).toBe(404);
  });

  it('rechaza un archivo que dice ser PNG pero no lo es', async () => {
    const t = await tokenCon('admin');
    const id = await idProducto('DEMO-BJ-R15-GN');
    const { registro } = await subirImagen(t, id, Buffer.from('<script>alert(1)</script>'));
    expect(registro.status).toBe(400);
    expect(registro.body.error.codigo).toBe('IMAGEN_INVALIDA');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM producto_imagenes')).rows[0].n).toBe(0);
  });

  it('no deja registrar una imagen de otro producto ni sin subirla', async () => {
    const t = await tokenCon('admin');
    const a = await idProducto('DEMO-BJ-R15-GN');
    const b = await idProducto('DEMO-BB-CRY-GN');
    const f = await request(app).post(`/api/admin/productos/${a}/imagenes/firma`).set(auth(t)).send({ tipo: 'image/png', bytes: 100 });
    expect((await request(app).post(`/api/admin/productos/${b}/imagenes`).set(auth(t)).send({ clave: f.body.data.clave })).body.error.codigo).toBe('CLAVE_INVALIDA');
    expect((await request(app).post(`/api/admin/productos/${a}/imagenes`).set(auth(t)).send({ clave: f.body.data.clave })).body.error.codigo).toBe('IMAGEN_NO_SUBIDA');
    expect((await request(app).post(`/api/admin/productos/${a}/imagenes/firma`).set(auth(t)).send({ tipo: 'image/png', bytes: 6 * 1024 * 1024 })).status).toBe(400);
  });
});

describe('adaptador de Supabase Storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pide la URL firmada con la clave del servidor y arma las URL públicas', async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(JSON.stringify({ url: '/object/upload/sign/productos/productos/1/x.png?token=abc' }), { status: 200 });
    });
    const s = new Supabase('https://proyecto.supabase.co/', 'clave-service-role-de-prueba', 'productos');
    const subida = await s.firmarSubida('productos/1/x.png', 'image/png');
    expect(llamadas[0].url).toBe('https://proyecto.supabase.co/storage/v1/object/upload/sign/productos/productos/1/x.png');
    expect((llamadas[0].init.headers as Record<string, string>).Authorization).toBe('Bearer clave-service-role-de-prueba');
    expect(subida).toMatchObject({ url: 'https://proyecto.supabase.co/storage/v1/object/upload/sign/productos/productos/1/x.png?token=abc', metodo: 'PUT' });
    expect(s.urlPublica('productos/1/x.png')).toBe('https://proyecto.supabase.co/storage/v1/object/public/productos/productos/1/x.png');
  });
});
