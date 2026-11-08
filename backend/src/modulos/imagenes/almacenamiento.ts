import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { AppError } from '../../errores';

/**
 * Almacenamiento de imágenes. La base de datos guarda solo la URL (nunca el archivo).
 * Flujo: el panel pide una URL firmada → sube el archivo DIRECTO al almacenamiento
 * → registra la imagen → el backend comprueba que el objeto existe, su tamaño y
 * que de verdad es JPG, PNG o WebP (por sus primeros bytes, no por el nombre).
 *
 * Adaptadores:
 * - supabase: Supabase Storage (producción). La clave service_role vive SOLO aquí.
 * - local: carpeta en el servidor (desarrollo y pruebas; el disco de Render se borra en cada despliegue).
 */
export const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type TipoImagen = keyof typeof TIPOS;
export const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;

export interface Subida {
  url: string;
  metodo: 'PUT';
  encabezados: Record<string, string>;
  expira_en_segundos: number;
}

export interface AlmacenamientoImagenes {
  firmarSubida(clave: string, tipo: TipoImagen): Promise<Subida>;
  /** Tamaño y primeros bytes del objeto, o null si no existe. */
  inspeccionar(clave: string): Promise<{ bytes: number; cabecera: Buffer } | null>;
  urlPublica(clave: string): string;
  borrar(clave: string): Promise<void>;
}

/** Tipo real según los primeros bytes ("número mágico"). */
export function tipoPorContenido(b: Buffer): TipoImagen | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export const claveNueva = (productoId: number, tipo: TipoImagen) => `productos/${productoId}/${crypto.randomUUID()}.${TIPOS[tipo]}`;
export const CLAVE_VALIDA = /^productos\/(\d+)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

// ---------------- Supabase Storage ----------------
export class Supabase implements AlmacenamientoImagenes {
  private base: string;
  private auth: Record<string, string>;
  constructor(url: string, clave: string, private bucket: string) {
    this.base = `${url.replace(/\/+$/, '')}/storage/v1`;
    this.auth = { Authorization: `Bearer ${clave}`, apikey: clave };
  }

  private async llamar(ruta: string, init: RequestInit) {
    let r: Response;
    try {
      r = await fetch(`${this.base}${ruta}`, { ...init, headers: { ...this.auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AppError(502, 'ALMACENAMIENTO_NO_DISPONIBLE', 'No se pudo conectar con el almacenamiento de imágenes');
    }
    return r;
  }

  async firmarSubida(clave: string, tipo: TipoImagen): Promise<Subida> {
    const r = await this.llamar(`/object/upload/sign/${this.bucket}/${clave}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new AppError(502, 'ALMACENAMIENTO_ERROR', 'El almacenamiento de imágenes rechazó la solicitud (revisa el bucket y la clave)');
    const { url } = (await r.json()) as { url: string };
    return { url: `${this.base}${url}`, metodo: 'PUT', encabezados: { 'content-type': tipo, 'x-upsert': 'false' }, expira_en_segundos: 7200 };
  }

  async inspeccionar(clave: string) {
    const r = await this.llamar(`/object/${this.bucket}/${clave}`, { method: 'GET', headers: { Range: 'bytes=0-15' } });
    if (r.status === 400 || r.status === 404) return null;
    if (!r.ok) throw new AppError(502, 'ALMACENAMIENTO_ERROR', 'No se pudo verificar la imagen en el almacenamiento');
    const cabecera = Buffer.from(await r.arrayBuffer()).subarray(0, 16);
    // Content-Range: bytes 0-15/123456 → tamaño total
    const total = Number(r.headers.get('content-range')?.split('/')[1] ?? r.headers.get('content-length') ?? NaN);
    return { bytes: Number.isFinite(total) ? total : Infinity, cabecera };
  }

  urlPublica(clave: string) {
    return `${this.base}/object/public/${this.bucket}/${clave}`;
  }

  async borrar(clave: string) {
    await this.llamar(`/object/${this.bucket}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [clave] }) });
  }
}

// ---------------- Local (desarrollo y pruebas) ----------------
export const RUTA_LOCAL = '/api/almacen-local';
class Local implements AlmacenamientoImagenes {
  dir = path.resolve(config.ALMACENAMIENTO_LOCAL_DIR);
  ruta(clave: string) {
    if (!CLAVE_VALIDA.test(clave)) throw new AppError(400, 'CLAVE_INVALIDA', 'Clave de imagen inválida');
    return path.join(this.dir, clave);
  }
  async firmarSubida(clave: string, tipo: TipoImagen): Promise<Subida> {
    // Token firmado de un solo propósito: solo sirve para subir ESTE archivo durante 15 minutos
    const token = jwt.sign({ clave, tipo }, config.JWT_SECRET, { audience: 'subida-local', expiresIn: 900 });
    return { url: `${RUTA_LOCAL}/subidas/${token}`, metodo: 'PUT', encabezados: { 'content-type': tipo }, expira_en_segundos: 900 };
  }
  async inspeccionar(clave: string) {
    try {
      const f = await fs.open(this.ruta(clave), 'r');
      try {
        const { size } = await f.stat();
        const cabecera = Buffer.alloc(16);
        const { bytesRead } = await f.read(cabecera, 0, 16, 0);
        return { bytes: size, cabecera: cabecera.subarray(0, bytesRead) };
      } finally {
        await f.close();
      }
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return null;
      throw e;
    }
  }
  urlPublica(clave: string) {
    return `${RUTA_LOCAL}/archivos/${clave}`;
  }
  async borrar(clave: string) {
    await fs.rm(this.ruta(clave), { force: true });
  }
  /** Lo usa la ruta PUT de subida local. */
  async guardar(token: string, tipoEnviado: string | undefined, cuerpo: Buffer) {
    let datos: { clave: string; tipo: TipoImagen };
    try {
      datos = jwt.verify(token, config.JWT_SECRET, { audience: 'subida-local' }) as typeof datos;
    } catch {
      throw new AppError(403, 'SUBIDA_INVALIDA', 'El enlace de subida venció o no es válido');
    }
    if (tipoEnviado !== datos.tipo) throw new AppError(400, 'TIPO_INVALIDO', 'El tipo del archivo no coincide con el solicitado');
    if (cuerpo.length > MAX_BYTES_IMAGEN) throw new AppError(413, 'ARCHIVO_GRANDE', 'La imagen supera 5 MB');
    const destino = this.ruta(datos.clave);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, cuerpo, { flag: 'wx' }).catch((e) => {
      if (e.code === 'EEXIST') throw new AppError(409, 'SUBIDA_USADA', 'Este enlace de subida ya se usó');
      throw e;
    });
  }
}

let instancia: AlmacenamientoImagenes | null | undefined;
export function almacenamiento(): AlmacenamientoImagenes {
  if (instancia === undefined) instancia = config.ALMACENAMIENTO === 'supabase' ? new Supabase(config.SUPABASE_URL!, config.SUPABASE_SERVICE_KEY!, config.SUPABASE_BUCKET) : config.ALMACENAMIENTO === 'local' ? new Local() : null;
  if (!instancia) {
    throw new AppError(503, 'IMAGENES_NO_CONFIGURADAS', 'El almacenamiento de imágenes no está configurado (variable ALMACENAMIENTO). Ver docs/CONFIGURACION_SERVICIOS.md');
  }
  return instancia;
}
export const almacenamientoLocal = () => (config.ALMACENAMIENTO === 'local' ? (almacenamiento() as Local) : null);
/** Solo para pruebas. */
export function fijarAlmacenamiento(a: AlmacenamientoImagenes | null | undefined) {
  instancia = a;
}
