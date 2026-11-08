import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { asegurarCategorias, categoriasHoja } from '../../modulos/catalogo/categorias';
import {
  actualizarFabricante,
  actualizarMarca,
  crearFabricante,
  esquemaCategoria,
  esquemaFabricante,
  esquemaMarca,
  esquemaProveedor,
  esquemaVersion,
  guardarCategoria,
  guardarProveedor,
  guardarVersion,
  listarCategoriasAdmin,
  listarProveedores,
  listarVersiones,
} from '../../modulos/catalogo/gestion';

/** Catálogo de motos, categorías, marcas y proveedores. */
export const r = Router();
const ver = requerirPermiso('catalogo.ver');
const editar = requerirPermiso('productos.editar');

// =====================================================================
// Marcas y modelos
// =====================================================================
// Una marca es "original" cuando es la del fabricante de una moto (fabricante_moto_id).
// Se devuelve `tipo` calculado para que el panel actual siga funcionando.
r.get(
  '/marcas',
  ver,
  h(async (_req, res) =>
    ok(
      res,
      (
        await pool.query(
          `SELECT m.id, m.nombre, CASE WHEN m.fabricante_moto_id IS NULL THEN 'generico' ELSE 'original' END AS tipo,
                  m.fabricante_moto_id, f.nombre AS fabricante_moto, m.activo, m.es_demo
           FROM marcas_repuesto m LEFT JOIN fabricantes_moto f ON f.id = m.fabricante_moto_id
           ORDER BY (m.fabricante_moto_id IS NOT NULL) DESC, m.nombre`,
        )
      ).rows,
    ),
  ),
);
r.post(
  '/marcas',
  editar,
  h(async (req, res) => {
    const d = z
      .object({
        nombre: z.string().trim().min(2).max(80),
        tipo: z.enum(['original', 'generico']).default('generico'),
        fabricante_moto_id: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    let fabricanteId = d.fabricante_moto_id ?? null;
    if (d.tipo === 'original' && !fabricanteId) {
      const f = await pool.query('SELECT id FROM fabricantes_moto WHERE lower(nombre) = lower($1)', [d.nombre]);
      fabricanteId = f.rows[0]?.id ?? null;
      if (!fabricanteId) {
        throw new AppError(400, 'FABRICANTE_REQUERIDO', 'Una marca original debe ser la de un fabricante de motos registrado (Yamaha, Honda, Bajaj…)');
      }
    }
    try {
      await enTransaccion(async (db) => {
        const { rows } = await db.query('INSERT INTO marcas_repuesto (nombre, fabricante_moto_id) VALUES ($1, $2) RETURNING *', [d.nombre, fabricanteId]);
        ok(res, { ...rows[0], tipo: fabricanteId ? 'original' : 'generico' }, 201);
      }, { usuarioId: req.usuario!.id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'MARCA_DUPLICADA', 'Ya existe una marca con ese nombre o para ese fabricante');
      throw e;
    }
  }),
);

r.get(
  '/categorias',
  ver,
  h(async (_req, res) => {
    await asegurarCategorias();
    ok(res, categoriasHoja().map(({ clave, etiqueta, requierePosicion, seguridad, padre }) => ({ clave, etiqueta, requierePosicion, seguridad, grupo: padre })));
  }),
);

r.get(
  '/fabricantes',
  ver,
  h(async (_req, res) => ok(res, (await pool.query('SELECT id, nombre, slug, activo, orden FROM fabricantes_moto ORDER BY orden, nombre')).rows)),
);

r.get(
  '/modelos',
  ver,
  h(async (_req, res) =>
    ok(
      res,
      (
        await pool.query(
          `SELECT mo.*, f.nombre AS fabricante FROM modelos_motocicleta mo JOIN fabricantes_moto f ON f.id = mo.fabricante_id ORDER BY f.nombre, mo.nombre`,
        )
      ).rows,
    ),
  ),
);
const esquemaModelo = z.object({
  fabricante_id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(80),
  cilindraje_cc: z.number().int().positive().nullable().optional(),
  anio_inicio: z.number().int().min(1950).max(2100).nullable().optional(),
  anio_fin: z.number().int().min(1950).max(2100).nullable().optional(),
  alias: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  activo: z.boolean().default(true),
});
function erroresModelo(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23505') throw new AppError(409, 'MODELO_DUPLICADO', 'Ese fabricante ya tiene un modelo con ese nombre');
  if (code === '23503') throw new AppError(400, 'FABRICANTE_INVALIDO', 'El fabricante no existe');
  throw e;
}
r.post(
  '/modelos',
  editar,
  h(async (req, res) => {
    const d = esquemaModelo.parse(req.body);
    const alias = [...new Set(d.alias.map((a) => a.toLowerCase()))];
    try {
      const { rows } = await enTransaccion(
        (db) =>
          db.query(
            'INSERT INTO modelos_motocicleta (fabricante_id, nombre, cilindraje_cc, anio_inicio, anio_fin, alias, activo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [d.fabricante_id, d.nombre, d.cilindraje_cc ?? null, d.anio_inicio ?? null, d.anio_fin ?? null, alias, d.activo],
          ),
        { usuarioId: req.usuario!.id },
      );
      ok(res, rows[0], 201);
    } catch (e) {
      erroresModelo(e);
    }
  }),
);
r.put(
  '/modelos/:id',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaModelo.parse(req.body);
    let rows;
    try {
      ({ rows } = await enTransaccion(
        (db) =>
          db.query(
            'UPDATE modelos_motocicleta SET fabricante_id=$2, nombre=$3, cilindraje_cc=$4, anio_inicio=$5, anio_fin=$6, alias=$7, activo=$8 WHERE id=$1 RETURNING *',
            [id, d.fabricante_id, d.nombre, d.cilindraje_cc ?? null, d.anio_inicio ?? null, d.anio_fin ?? null, [...new Set(d.alias.map((a) => a.toLowerCase()))], d.activo],
          ),
        { usuarioId: req.usuario!.id },
      ));
    } catch (e) {
      erroresModelo(e);
    }
    if (!rows?.[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Modelo no encontrado');
    ok(res, rows[0]);
  }),
);


// =====================================================================
// Gestión ampliada (fase 4B)
// =====================================================================
const id = (v: unknown) => z.coerce.number().int().positive().parse(v);

r.post('/fabricantes', editar, h(async (req, res) => ok(res, await crearFabricante(esquemaFabricante.parse(req.body), req.usuario!.id), 201)));
r.put('/fabricantes/:id', editar, h(async (req, res) => ok(res, await actualizarFabricante(id(req.params.id), esquemaFabricante.parse(req.body), req.usuario!.id))));

r.get('/versiones', ver, h(async (req, res) => ok(res, await listarVersiones(req.query.modelo_id ? id(req.query.modelo_id) : undefined))));
r.post('/versiones', editar, h(async (req, res) => ok(res, await guardarVersion(null, esquemaVersion.parse(req.body), req.usuario!.id), 201)));
r.put('/versiones/:id', editar, h(async (req, res) => ok(res, await guardarVersion(id(req.params.id), esquemaVersion.parse(req.body), req.usuario!.id))));

r.get('/categorias/arbol', ver, h(async (_req, res) => ok(res, await listarCategoriasAdmin())));
r.post('/categorias', editar, h(async (req, res) => ok(res, await guardarCategoria(null, esquemaCategoria.parse(req.body), req.usuario!.id), 201)));
r.put('/categorias/:id', editar, h(async (req, res) => ok(res, await guardarCategoria(id(req.params.id), esquemaCategoria.parse(req.body), req.usuario!.id))));

r.put('/marcas/:id', editar, h(async (req, res) => ok(res, await actualizarMarca(id(req.params.id), esquemaMarca.parse(req.body), req.usuario!.id))));

r.get('/proveedores', ver, h(async (_req, res) => ok(res, await listarProveedores())));
r.post('/proveedores', requerirPermiso('compras.gestionar'), h(async (req, res) => ok(res, await guardarProveedor(null, esquemaProveedor.parse(req.body), req.usuario!.id), 201)));
r.put('/proveedores/:id', requerirPermiso('compras.gestionar'), h(async (req, res) => ok(res, await guardarProveedor(id(req.params.id), esquemaProveedor.parse(req.body), req.usuario!.id))));
