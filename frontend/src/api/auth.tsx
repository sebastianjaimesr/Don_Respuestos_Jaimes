import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, registrarAlExpirar, sesion } from './cliente';

export type Rol = 'admin' | 'vendedor' | 'consulta';
export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
  email?: string;
}

interface Ctx {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => void;
  puede: (...roles: Rol[]) => boolean;
}

const AuthCtx = createContext<Ctx | null>(null);

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  const salir = useCallback(() => {
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
    setUsuario(r.usuario);
  };

  // Ocultar botones es solo comodidad visual: el backend vuelve a verificar el rol.
  const puede = (...roles: Rol[]) => !!usuario && roles.includes(usuario.rol);

  return <AuthCtx.Provider value={{ usuario, cargando, entrar, salir, puede }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth fuera de ProveedorAuth');
  return c;
}
