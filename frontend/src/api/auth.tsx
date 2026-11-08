import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, registrarAlExpirar, sesion } from './cliente';

export type Rol = 'admin' | 'vendedor' | 'consulta';
export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
  email?: string;
  /** Permisos del rol, tal como los verifica el servidor. */
  permisos?: string[];
}

interface Ctx {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => void;
  puede: (...roles: Rol[]) => boolean;
  /** true si el usuario tiene TODOS los permisos indicados. */
  tiene: (...permisos: string[]) => boolean;
}

const AuthCtx = createContext<Ctx | null>(null);

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  const salir = useCallback(() => {
    // Cierra también la cookie de sesión, si el servidor la había abierto
    void api('/auth/logout', { metodo: 'POST', auth: true }).catch(() => undefined);
    sesion.borrar();
    setUsuario(null);
  }, []);

  useEffect(() => {
    registrarAlExpirar(() => setUsuario(null));
    if (!sesion.token()) return setCargando(false);
    api<Usuario>('/auth/yo', { auth: true })
      .then(setUsuario)
      .catch(() => sesion.borrar())
      .finally(() => setCargando(false));
  }, []);

  const entrar = async (email: string, password: string) => {
    const r = await api<{ token: string; usuario: Usuario }>('/auth/login', { metodo: 'POST', cuerpo: { email, password } });
    sesion.guardar(r.token);
    // El login no trae los permisos: se piden a /auth/yo
    setUsuario(await api<Usuario>('/auth/yo', { auth: true }).catch(() => r.usuario));
  };

  // Ocultar botones es solo comodidad visual: el backend vuelve a verificar el rol.
  const puede = (...roles: Rol[]) => !!usuario && roles.includes(usuario.rol);
  const tiene = (...permisos: string[]) => !!usuario && (usuario.rol === 'admin' || permisos.every((p) => usuario.permisos?.includes(p)));

  return <AuthCtx.Provider value={{ usuario, cargando, entrar, salir, puede, tiene }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth fuera de ProveedorAuth');
  return c;
}
