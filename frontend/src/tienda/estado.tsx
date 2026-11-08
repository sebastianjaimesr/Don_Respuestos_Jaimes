import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ErrorApi, fijarCsrfCliente } from '../api/cliente';
import { tienda, type Carrito, type Cliente } from '../api/tienda';

/**
 * Estado compartido de la tienda.
 * - Carrito: vive en el SERVIDOR (precios y stock se recalculan allá). En el
 *   navegador solo se recuerda su id para poder volver a abrirlo.
 * - Moto elegida: preferencia de interfaz (no es un dato de negocio).
 * - Sesión del cliente: cookie HttpOnly; aquí solo se guarda quién es.
 */
const CLAVE_CARRITO = 'drj_carrito';
const CLAVE_MOTO = 'drj_moto';

export interface MotoElegida {
  fabricanteId: number;
  fabricante: string;
  modeloId: number;
  modelo: string;
  anio: number | null;
}

const leer = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const escribir = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* navegación privada: se sigue sin recordar */
  }
};

function leerMoto(): MotoElegida | null {
  try {
    const m = JSON.parse(leer(CLAVE_MOTO) ?? 'null');
    return m && typeof m.modeloId === 'number' ? m : null;
  } catch {
    return null;
  }
}

interface Ctx {
  carrito: Carrito | null;
  unidades: number;
  cargandoCarrito: boolean;
  agregar: (productoId: number, cantidad?: number) => Promise<Carrito>;
  fijarCantidad: (productoId: number, cantidad: number) => Promise<void>;
  quitar: (productoId: number) => Promise<void>;
  recargarCarrito: () => Promise<void>;
  olvidarCarrito: () => void;

  moto: MotoElegida | null;
  elegirMoto: (m: MotoElegida | null) => void;

  cliente: Cliente | null;
  verificandoSesion: boolean;
  ingresar: (email: string, password: string) => Promise<void>;
  registrarse: (d: { nombre: string; email: string; telefono: string; password: string; ciudad?: string }) => Promise<void>;
  salir: () => Promise<void>;

  favoritos: Set<number>;
  alternarFavorito: (productoId: number) => Promise<void>;
}

const TiendaCtx = createContext<Ctx | null>(null);

export function ProveedorTienda({ children }: { children: ReactNode }) {
  const [carrito, setCarrito] = useState<Carrito | null>(null);
  const [cargandoCarrito, setCargandoCarrito] = useState(false);
  const [moto, setMoto] = useState<MotoElegida | null>(leerMoto);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [verificandoSesion, setVerificando] = useState(true);
  const [favoritos, setFavoritos] = useState<Set<number>>(new Set());
  const creando = useRef<Promise<Carrito> | null>(null);

  const guardarCarrito = useCallback((c: Carrito | null) => {
    setCarrito(c);
    escribir(CLAVE_CARRITO, c && c.estado === 'activo' ? c.id : null);
  }, []);

  const recargarCarrito = useCallback(async () => {
    const id = leer(CLAVE_CARRITO);
    if (!id) return setCarrito(null);
    setCargandoCarrito(true);
    try {
      const c = await tienda.carrito(id);
      guardarCarrito(c.estado === 'activo' ? c : null);
    } catch (e) {
      // 404: el carrito ya no existe o es de otra cuenta → se empieza uno nuevo
      if (e instanceof ErrorApi && (e.status === 404 || e.status === 400)) guardarCarrito(null);
    } finally {
      setCargandoCarrito(false);
    }
  }, [guardarCarrito]);

  /** Devuelve el carrito activo o crea uno (una sola creación aunque se llame varias veces). */
  const asegurarCarrito = useCallback(async () => {
    if (carrito?.estado === 'activo') return carrito;
    creando.current ??= tienda.crearCarrito().finally(() => (creando.current = null));
    const c = await creando.current;
    guardarCarrito(c);
    return c;
  }, [carrito, guardarCarrito]);

  const conCarrito = useCallback(
    async (fn: (id: string) => Promise<Carrito>) => {
      const c = await asegurarCarrito();
      try {
        const nuevo = await fn(c.id);
        guardarCarrito(nuevo);
        return nuevo;
      } catch (e) {
        if (e instanceof ErrorApi && (e.codigo === 'CARRITO_CERRADO' || e.status === 404)) {
          // El carrito se convirtió en pedido en otra pestaña: se crea uno nuevo y se reintenta
          guardarCarrito(null);
          const otro = await tienda.crearCarrito();
          const nuevo = await fn(otro.id);
          guardarCarrito(nuevo);
          return nuevo;
        }
        throw e;
      }
    },
    [asegurarCarrito, guardarCarrito],
  );

  const agregar = useCallback(
    (productoId: number, cantidad = 1) =>
      conCarrito((id) => {
        const actual = carrito?.id === id ? carrito.items.find((i) => i.producto_id === productoId)?.cantidad ?? 0 : 0;
        return tienda.fijarItem(id, productoId, actual + cantidad);
      }),
    [carrito, conCarrito],
  );
  const fijarCantidad = useCallback(async (productoId: number, cantidad: number) => void (await conCarrito((id) => tienda.fijarItem(id, productoId, cantidad))), [conCarrito]);
  const quitar = useCallback(async (productoId: number) => void (await conCarrito((id) => tienda.quitarItem(id, productoId))), [conCarrito]);
  const olvidarCarrito = useCallback(() => guardarCarrito(null), [guardarCarrito]);

  const elegirMoto = useCallback((m: MotoElegida | null) => {
    setMoto(m);
    escribir(CLAVE_MOTO, m ? JSON.stringify(m) : null);
  }, []);

  const cargarFavoritos = useCallback(async () => {
    try {
      setFavoritos(new Set((await tienda.favoritos()).map((f) => f.producto_id)));
    } catch {
      setFavoritos(new Set());
    }
  }, []);

  /** Después de entrar: el carrito anónimo se une al de la cuenta. */
  const alEntrar = useCallback(
    async (c: Cliente, csrf: string | null) => {
      fijarCsrfCliente(csrf);
      setCliente(c);
      const anon = leer(CLAVE_CARRITO);
      if (anon) {
        try {
          guardarCarrito(await tienda.fusionarCarrito(anon));
        } catch {
          await recargarCarrito();
        }
      }
      await cargarFavoritos();
    },
    [cargarFavoritos, guardarCarrito, recargarCarrito],
  );

  useEffect(() => {
    let vivo = true;
    tienda
      .yo()
      .then((r) => (vivo ? alEntrar(r.cliente, r.csrf) : undefined))
      .catch(() => undefined)
      .finally(() => {
        if (!vivo) return;
        setVerificando(false);
        void recargarCarrito();
      });
    return () => {
      vivo = false;
    };
    // Solo al abrir la tienda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingresar = useCallback(async (email: string, password: string) => {
    const r = await tienda.ingresar(email, password);
    await alEntrar(r.cliente, r.csrf);
  }, [alEntrar]);
  const registrarse = useCallback(
    async (d: { nombre: string; email: string; telefono: string; password: string; ciudad?: string }) => {
      const r = await tienda.registro(d);
      await alEntrar(r.cliente, r.csrf);
    },
    [alEntrar],
  );
  const salir = useCallback(async () => {
    await tienda.salir().catch(() => undefined);
    fijarCsrfCliente(null);
    setCliente(null);
    setFavoritos(new Set());
    guardarCarrito(null); // el carrito era de la cuenta
  }, [guardarCarrito]);

  const alternarFavorito = useCallback(
    async (productoId: number) => {
      const tiene = favoritos.has(productoId);
      if (tiene) await tienda.quitarFavorito(productoId);
      else await tienda.agregarFavorito(productoId);
      setFavoritos((s) => {
        const n = new Set(s);
        if (tiene) n.delete(productoId);
        else n.add(productoId);
        return n;
      });
    },
    [favoritos],
  );

  const valor = useMemo<Ctx>(
    () => ({
      carrito,
      unidades: carrito?.items.reduce((s, i) => s + i.cantidad, 0) ?? 0,
      cargandoCarrito,
      agregar,
      fijarCantidad,
      quitar,
      recargarCarrito,
      olvidarCarrito,
      moto,
      elegirMoto,
      cliente,
      verificandoSesion,
      ingresar,
      registrarse,
      salir,
      favoritos,
      alternarFavorito,
    }),
    [carrito, cargandoCarrito, agregar, fijarCantidad, quitar, recargarCarrito, olvidarCarrito, moto, elegirMoto, cliente, verificandoSesion, ingresar, registrarse, salir, favoritos, alternarFavorito],
  );
  return <TiendaCtx.Provider value={valor}>{children}</TiendaCtx.Provider>;
}

export function useTienda() {
  const c = useContext(TiendaCtx);
  if (!c) throw new Error('useTienda fuera de ProveedorTienda');
  return c;
}

/** Datos de una petición con estados de carga y error (y reintento). */
export function useDatos<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [estado, setEstado] = useState<{ datos: T | null; cargando: boolean; error: ErrorApi | Error | null }>({ datos: null, cargando: true, error: null });
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true, error: null }));
    fn()
      .then((datos) => vivo && setEstado({ datos, cargando: false, error: null }))
      .catch((error) => vivo && setEstado({ datos: null, cargando: false, error }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intento]);
  return { ...estado, reintentar: () => setIntento((x) => x + 1) };
}
