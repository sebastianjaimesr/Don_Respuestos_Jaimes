import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { h, ok } from '../utils/http';
import { sesionCliente } from '../middleware/auth';
import { abrirSesion, cerrarSesion, COOKIE, leerCookie, tokenCsrf } from '../middleware/sesion';
import {
  detalleProducto,
  destacados,
  esquemaFiltros,
  fabricantesActivos,
  listarProductos,
  modelosDeFabricante,
  relacionados,
  sugerencias,
  tarifasEnvio,
  versionesDeModelo,
} from '../modulos/catalogo/publico';
import { arbolDeCategorias, asegurarCategorias } from '../modulos/catalogo/categorias';
import { checkout, crearCarrito, fijarItem, fusionarCarrito, obtenerCarrito, quitarItem } from '../modulos/ventas/carrito';
import {
  agregarFavorito,
  esquemaRegistro,
  iniciarSesionCliente,
  listarFavoritos,
  pedidoDelCliente,
  pedidosDelCliente,
  quitarFavorito,
  registrarCliente,
} from '../modulos/clientes/cuentas';

/** Tienda en línea: catálogo público, carrito y cuentas de cliente. */
export const rutasTienda = Router();

const limite = (por15min: number, codigo = 'DEMASIADAS_SOLICITUDES', mensaje = 'Demasiadas solicitudes. Espera un momento.') =>
  rateLimit({ windowMs: 15 * 60_000, limit: por15min, standardHeaders: 'draft-7', legacyHeaders: false, message: { ok: false, error: { codigo, mensaje } } });
const limiteBusqueda = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const limiteCheckout = limite(20);
const limiteCuenta = limite(config.RATE_LIMIT_LOGIN_POR_15MIN, 'DEMASIADOS_INTENTOS', 'Demasiados intentos. Espera 15 minutos.');

const idNum = (v: unknown) => z.coerce.number().int().positive().parse(v);
const uuid = (v: unknown) => z.string().uuid({ message: 'Carrito inválido' }).parse(v);

// ---------------- Catálogo ----------------
rutasTienda.get('/catalogo/productos', limiteBusqueda, h(async (req, res) => ok(res, await listarProductos(esquemaFiltros.parse(req.query)))));
rutasTienda.get('/catalogo/productos/:slug', h(async (req, res) => ok(res, await detalleProducto(z.string().max(200).parse(req.params.slug)))));
rutasTienda.get('/catalogo/productos/:slug/relacionados', h(async (req, res) => ok(res, await relacionados(z.string().max(200).parse(req.params.slug)))));
rutasTienda.get('/catalogo/destacados', h(async (_req, res) => ok(res, await destacados())));
rutasTienda.get('/catalogo/sugerencias', limiteBusqueda, h(async (req, res) => ok(res, await sugerencias(z.string().max(80).default('').parse(req.query.q)))));
rutasTienda.get(
  '/catalogo/categorias',
  h(async (_req, res) => {
    await asegurarCategorias();
    ok(res, arbolDeCategorias());
  }),
);
rutasTienda.get('/catalogo/fabricantes', h(async (_req, res) => ok(res, await fabricantesActivos())));
rutasTienda.get('/catalogo/fabricantes/:id/modelos', h(async (req, res) => ok(res, await modelosDeFabricante(idNum(req.params.id)))));
rutasTienda.get('/catalogo/modelos/:id/versiones', h(async (req, res) => ok(res, await versionesDeModelo(idNum(req.params.id)))));
rutasTienda.get('/envios/tarifas', h(async (_req, res) => ok(res, await tarifasEnvio())));

// ---------------- Carrito ----------------
const conCliente = sesionCliente(false);
const clienteDe = (req: { cliente?: { id: number } }) => req.cliente?.id ?? null;

rutasTienda.post('/carritos', conCliente, h(async (req, res) => ok(res, await crearCarrito(clienteDe(req)), 201)));
rutasTienda.get('/carritos/:id', conCliente, h(async (req, res) => ok(res, await obtenerCarrito(uuid(req.params.id), clienteDe(req)))));
rutasTienda.put(
  '/carritos/:id/items/:productoId',
  conCliente,
  h(async (req, res) => {
    const { cantidad } = z.object({ cantidad: z.number().int() }).parse(req.body);
    ok(res, await fijarItem(uuid(req.params.id), clienteDe(req), idNum(req.params.productoId), cantidad));
  }),
);
rutasTienda.delete('/carritos/:id/items/:productoId', conCliente, h(async (req, res) => ok(res, await quitarItem(uuid(req.params.id), clienteDe(req), idNum(req.params.productoId)))));
rutasTienda.post(
  '/carritos/:id/checkout',
  limiteCheckout,
  conCliente,
  h(async (req, res) => {
    const clave = req.headers['idempotency-key'] ? z.string().min(8).max(120).parse(req.headers['idempotency-key']) : undefined;
    const r = await checkout(uuid(req.params.id), clienteDe(req), req.body, clave);
    ok(res, r, r.pedido.idempotente ? 200 : 201);
  }),
);

// ---------------- Cuentas de cliente ----------------
rutasTienda.post(
  '/clientes/registro',
  limiteCuenta,
  h(async (req, res) => {
    const r = await registrarCliente(esquemaRegistro.parse(req.body));
    ok(res, { cliente: r.cliente, csrf: abrirSesion(res, 'tienda', r.token) }, 201);
  }),
);
rutasTienda.post(
  '/clientes/sesion',
  limiteCuenta,
  h(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email().max(160), password: z.string().min(1).max(200) }).parse(req.body);
    const r = await iniciarSesionCliente(email, password);
    ok(res, { cliente: r.cliente, csrf: abrirSesion(res, 'tienda', r.token) });
  }),
);
rutasTienda.delete('/clientes/sesion', (_req, res) => {
  cerrarSesion(res, 'tienda');
  ok(res, { sesion: 'cerrada' });
});

const cuenta = Router();
cuenta.use(sesionCliente(true));
rutasTienda.use('/clientes/yo', cuenta);

// /yo devuelve también el token CSRF: el frontend lo pide al recargar la página.
cuenta.get('/', (req, res) => {
  const t = leerCookie(req, COOKIE.tienda);
  ok(res, { cliente: req.cliente, csrf: t ? tokenCsrf(t) : null });
});
cuenta.get('/pedidos', h(async (req, res) => ok(res, await pedidosDelCliente(req.cliente!.id))));
cuenta.get('/pedidos/:codigo', h(async (req, res) => ok(res, await pedidoDelCliente(req.cliente!.id, z.string().max(20).parse(req.params.codigo)))));
cuenta.get('/favoritos', h(async (req, res) => ok(res, await listarFavoritos(req.cliente!.id))));
cuenta.put(
  '/favoritos/:productoId',
  h(async (req, res) => {
    await agregarFavorito(req.cliente!.id, idNum(req.params.productoId));
    ok(res, await listarFavoritos(req.cliente!.id));
  }),
);
cuenta.delete(
  '/favoritos/:productoId',
  h(async (req, res) => {
    await quitarFavorito(req.cliente!.id, idNum(req.params.productoId));
    ok(res, await listarFavoritos(req.cliente!.id));
  }),
);
cuenta.post(
  '/carrito/fusionar',
  h(async (req, res) => {
    const { carrito_id } = z.object({ carrito_id: z.string().uuid() }).parse(req.body);
    ok(res, await fusionarCarrito(carrito_id, req.cliente!.id));
  }),
);
