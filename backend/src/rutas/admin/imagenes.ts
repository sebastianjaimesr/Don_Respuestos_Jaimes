import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion } from '../../db';
import { AppError } from '../../errores';
import { h, ok } from '../../utils/http';
import { requerirPermiso } from '../../middleware/auth';
import { almacenamiento, CLAVE_VALIDA, claveNueva, MAX_BYTES_IMAGEN, TIPOS, tipoPorContenido } from '../../modulos/imagenes/almacenamiento';

/** Imágenes de productos: URL firmada → subida directa → registro verificado. */
export const r = Router();
const ver = requerirPermiso('catalogo.ver');
const editar = requerirPermiso('imagenes.editar');
const MAX_IMAGENES = 10;

const listar = async (productoId: number) =>
  (await pool.query('SELECT id, url, alt, orden, es_principal, created_at FROM producto_imagenes WHERE producto_id = $1 ORDER BY es_principal DESC, orden, id', [productoId])).rows;

async function exigirProducto(id: number) {
  if (!(await pool.query('SELECT 1 FROM productos WHERE id = $1', [id])).rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
}

r.get('/productos/:id/imagenes', ver, h(async (req, res) => ok(res, await listar(z.coerce.number().int().parse(req.params.id)))));

r.post(
  '/productos/:id/imagenes/firma',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = z
      .object({ tipo: z.enum(Object.keys(TIPOS) as [keyof typeof TIPOS]), bytes: z.number().int().positive().max(MAX_BYTES_IMAGEN, 'La imagen supera 5 MB') })
      .parse(req.body);
    await exigirProducto(id);
    const n = (await pool.query('SELECT COUNT(*)::int AS n FROM producto_imagenes WHERE producto_id = $1', [id])).rows[0].n;
    if (n >= MAX_IMAGENES) throw new AppError(409, 'DEMASIADAS_IMAGENES', `Máximo ${MAX_IMAGENES} imágenes por producto`);
    const clave = claveNueva(id, d.tipo);
    ok(res, { clave, subida: await almacenamiento().firmarSubida(clave, d.tipo) }, 201);
  }),
);

r.post(
  '/productos/:id/imagenes',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = z.object({ clave: z.string().max(300), alt: z.string().trim().max(200).nullable().optional(), principal: z.boolean().default(false) }).parse(req.body);
    const m = CLAVE_VALIDA.exec(d.clave);
    if (!m || Number(m[1]) !== id) throw new AppError(400, 'CLAVE_INVALIDA', 'Esa imagen no corresponde a este producto');
    await exigirProducto(id);
    const alm = almacenamiento();
    const obj = await alm.inspeccionar(d.clave);
    if (!obj) throw new AppError(400, 'IMAGEN_NO_SUBIDA', 'La imagen no se encontró en el almacenamiento: súbela primero');
    // Se verifica el CONTENIDO real, no el nombre ni lo que diga el navegador
    const tipo = tipoPorContenido(obj.cabecera);
    if (obj.bytes > MAX_BYTES_IMAGEN || !tipo || TIPOS[tipo] !== m[2]) {
      await alm.borrar(d.clave);
      throw new AppError(400, 'IMAGEN_INVALIDA', obj.bytes > MAX_BYTES_IMAGEN ? 'La imagen supera 5 MB' : 'El archivo no es una imagen JPG, PNG o WebP válida');
    }
    try {
      await enTransaccion(async (db) => {
        await db.query('SELECT id FROM productos WHERE id = $1 FOR UPDATE', [id]);
        const hay = (await db.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(orden), -1) AS max FROM producto_imagenes WHERE producto_id = $1', [id])).rows[0];
        const principal = d.principal || hay.n === 0; // la primera foto es la principal
        if (principal) await db.query('UPDATE producto_imagenes SET es_principal = false WHERE producto_id = $1', [id]);
        await db.query(
          'INSERT INTO producto_imagenes (producto_id, url, clave_almacenamiento, alt, orden, es_principal) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, alm.urlPublica(d.clave), d.clave, d.alt ?? null, hay.max + 1, principal],
        );
      }, { usuarioId: req.usuario!.id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'IMAGEN_DUPLICADA', 'Esta imagen ya está registrada');
      throw e;
    }
    ok(res, await listar(id), 201);
  }),
);

r.patch(
  '/imagenes/:id',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = z
      .object({ alt: z.string().trim().max(200).nullable().optional(), orden: z.number().int().min(0).max(100).optional(), principal: z.literal(true).optional() })
      .parse(req.body);
    const productoId = await enTransaccion(async (db) => {
      const img = (await db.query('SELECT producto_id FROM producto_imagenes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!img) throw new AppError(404, 'NO_ENCONTRADO', 'Imagen no encontrada');
      if (d.principal) await db.query('UPDATE producto_imagenes SET es_principal = false WHERE producto_id = $1 AND id <> $2', [img.producto_id, id]);
      await db.query(
        `UPDATE producto_imagenes SET alt = CASE WHEN $2 THEN $3 ELSE alt END, orden = COALESCE($4, orden), es_principal = es_principal OR COALESCE($5, false) WHERE id = $1`,
        [id, d.alt !== undefined, d.alt ?? null, d.orden ?? null, d.principal ?? null],
      );
      return img.producto_id as number;
    }, { usuarioId: req.usuario!.id });
    ok(res, await listar(productoId));
  }),
);

r.delete(
  '/imagenes/:id',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const img = await enTransaccion(async (db) => {
      const i = (await db.query('DELETE FROM producto_imagenes WHERE id = $1 RETURNING producto_id, clave_almacenamiento, es_principal', [id])).rows[0];
      if (!i) throw new AppError(404, 'NO_ENCONTRADO', 'Imagen no encontrada');
      // Si se borró la principal, la siguiente pasa a ser principal
      if (i.es_principal) {
        await db.query(
          `UPDATE producto_imagenes SET es_principal = true WHERE id = (SELECT id FROM producto_imagenes WHERE producto_id = $1 ORDER BY orden, id LIMIT 1)`,
          [i.producto_id],
        );
      }
      return i;
    }, { usuarioId: req.usuario!.id });
    // El archivo se borra después de confirmar la base de datos: si falla, queda un archivo huérfano, nunca un registro roto
    if (img.clave_almacenamiento) await almacenamiento().borrar(img.clave_almacenamiento).catch(() => undefined);
    ok(res, await listar(img.producto_id));
  }),
);
