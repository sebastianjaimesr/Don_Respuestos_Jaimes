import { useState, type FormEvent } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { fecha } from '../../api/formato';
import { Pestanas } from '../../componentes/editor';
import { Alerta, Boton, Campo, Cargando, Insignia, mensajeError, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  ultimo_acceso: string | null;
}
interface Rol {
  clave: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: boolean;
  permisos: string[];
  usuarios: number;
}
interface Roles {
  roles: Rol[];
  permisos: { clave: string; descripcion: string }[];
}

export default function Usuarios() {
  const [pestana, setPestana] = useState<'usuarios' | 'roles'>('usuarios');
  const roles = useCarga(() => apiAdmin<Roles>('/admin/roles'), []);
  return (
    <>
      <Titulo descripcion="Quién entra al panel y qué puede hacer. Los permisos se verifican en el servidor en cada acción.">Usuarios y roles</Titulo>
      <Pestanas
        opciones={[
          { v: 'usuarios', t: 'Usuarios' },
          { v: 'roles', t: 'Roles y permisos' },
        ]}
        valor={pestana}
        onCambiar={setPestana}
      />
      {roles.error && <Alerta>{roles.error}</Alerta>}
      {!roles.datos ? <Cargando /> : pestana === 'usuarios' ? <ListaUsuarios roles={roles.datos.roles} /> : <MatrizRoles datos={roles.datos} recargar={roles.recargar} />}
    </>
  );
}

function ListaUsuarios({ roles }: { roles: Rol[] }) {
  const { usuario } = useAuth();
  const lista = useCarga(() => apiAdmin<Usuario[]>('/admin/asesores'), []);
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'vendedor' });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const nombreRol = (c: string) => roles.find((r) => r.clave === c)?.nombre ?? c;

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    try {
      await apiAdmin('/admin/asesores', 'POST', f);
      setOk(`Usuario ${f.email} creado. Entrégale la contraseña temporal por un canal seguro.`);
      setF({ nombre: '', email: '', password: '', rol: 'vendedor' });
      void lista.recargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };
  const cambiar = async (u: Usuario, cuerpo: { activo?: boolean; rol?: string }) => {
    setError(null);
    try {
      await apiAdmin(`/admin/asesores/${u.id}`, 'PATCH', cuerpo);
      void lista.recargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Tarjeta titulo="Usuarios">
        {error && <Alerta>{error}</Alerta>}
        {!lista.datos ? (
          <Cargando />
        ) : (
          <Tabla columnas={['Nombre', 'Rol', 'Último acceso', 'Estado', '']} amplia>
            {lista.datos.map((u) => {
              const yo = u.id === usuario?.id;
              return (
                <tr key={u.id}>
                  <td className="px-2 py-2">
                    {u.nombre} {yo && <span className="text-xs text-gris-tec">(tú)</span>}
                    <div className="text-xs text-gris-tec">{u.email}</div>
                  </td>
                  <td className="px-2 py-2">
                    {yo ? (
                      nombreRol(u.rol)
                    ) : (
                      <select
                        aria-label={`Rol de ${u.nombre}`}
                        value={u.rol}
                        onChange={(e) => cambiar(u, { rol: e.target.value })}
                        className="rounded-lg border border-white/15 bg-noche-900 px-2 py-1 text-sm"
                      >
                        {roles.map((r) => (
                          <option key={r.clave} value={r.clave}>
                            {r.nombre}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">{fecha(u.ultimo_acceso)}</td>
                  <td className="px-2 py-2">{u.activo ? <Insignia color="verde" texto="Activo" /> : <Insignia color="gris" texto="Inactivo" />}</td>
                  <td className="px-2 py-2 text-right">
                    {!yo && (
                      <Boton tamano="sm" variante="secundario" onClick={() => cambiar(u, { activo: !u.activo })}>
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </Boton>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </Tarjeta>
      <Tarjeta titulo="Nuevo usuario">
        <form onSubmit={crear} className="flex flex-col gap-3">
          {ok && <Alerta tipo="exito">{ok}</Alerta>}
          <Campo etiqueta="Nombre" value={f.nombre} onChange={set('nombre')} required />
          <Campo etiqueta="Correo" type="email" value={f.email} onChange={set('email')} required autoComplete="off" />
          <Campo etiqueta="Contraseña temporal" type="password" value={f.password} onChange={set('password')} required minLength={10} autoComplete="new-password" ayuda="Mínimo 10 caracteres, con letras y números." />
          <Selector etiqueta="Rol" value={f.rol} onChange={set('rol')}>
            {roles.map((r) => (
              <option key={r.clave} value={r.clave}>
                {r.nombre}
                {r.descripcion ? ` — ${r.descripcion}` : ''}
              </option>
            ))}
          </Selector>
          <Boton type="submit">Crear usuario</Boton>
        </form>
      </Tarjeta>
    </div>
  );
}

function MatrizRoles({ datos, recargar }: { datos: Roles; recargar: () => Promise<void> }) {
  const [cambios, setCambios] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ clave: '', nombre: '', descripcion: '' });
  const permisosDe = (r: Rol) => cambios[r.clave] ?? new Set(r.permisos);
  const alternar = (r: Rol, p: string) =>
    setCambios((c) => {
      const s = new Set(permisosDe(r));
      if (s.has(p)) s.delete(p);
      else s.add(p);
      return { ...c, [r.clave]: s };
    });
  const editables = datos.roles.filter((r) => r.clave !== 'admin');

  const guardar = async (r: Rol) => {
    setError(null);
    setOk(null);
    try {
      await apiAdmin(`/admin/roles/${r.clave}/permisos`, 'PUT', { permisos: [...permisosDe(r)] });
      setCambios((c) => {
        const { [r.clave]: _, ...resto } = c;
        return resto;
      });
      setOk(`Permisos de "${r.nombre}" guardados. Aplican desde la próxima acción de esos usuarios.`);
      await recargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };
  const crearRol = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiAdmin('/admin/roles', 'POST', { clave: nuevo.clave, nombre: nuevo.nombre, descripcion: nuevo.descripcion || null });
      setNuevo({ clave: '', nombre: '', descripcion: '' });
      setOk('Rol creado. Ahora marca sus permisos y guarda.');
      await recargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <div className="space-y-4">
      {error && <Alerta>{error}</Alerta>}
      {ok && <Alerta tipo="exito">{ok}</Alerta>}
      <Tarjeta titulo="Permisos por rol">
        <p className="mb-3 text-xs text-gris-tec">El rol Administrador siempre tiene todos los permisos, para que nunca te quedes sin acceso.</p>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-gris-tec">
                <th scope="col" className="px-2 py-2 font-medium">
                  Permiso
                </th>
                {editables.map((r) => (
                  <th key={r.clave} scope="col" className="px-2 py-2 text-center font-medium">
                    {r.nombre}
                    <span className="block text-[11px] font-normal">{r.usuarios} usuarios</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {datos.permisos.map((p) => (
                <tr key={p.clave}>
                  <td className="px-2 py-2">
                    {p.descripcion}
                    <span className="block font-mono text-[11px] text-gris-tec">{p.clave}</span>
                  </td>
                  {editables.map((r) => (
                    <td key={r.clave} className="px-2 py-2 text-center">
                      <input type="checkbox" aria-label={`${r.nombre}: ${p.descripcion}`} className="h-4 w-4 accent-electrico-500" checked={permisosDe(r).has(p.clave)} onChange={() => alternar(r, p.clave)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                {editables.map((r) => (
                  <td key={r.clave} className="px-2 py-3 text-center">
                    <Boton tamano="sm" disabled={!cambios[r.clave]} onClick={() => guardar(r)}>
                      Guardar
                    </Boton>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Nuevo rol">
        <form onSubmit={crearRol} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Campo etiqueta="Clave" value={nuevo.clave} onChange={(e) => setNuevo((x) => ({ ...x, clave: e.target.value }))} placeholder="bodega" ayuda="Minúsculas y guion bajo" required />
          <Campo etiqueta="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo((x) => ({ ...x, nombre: e.target.value }))} placeholder="Bodega" required />
          <Campo etiqueta="Descripción (opcional)" value={nuevo.descripcion} onChange={(e) => setNuevo((x) => ({ ...x, descripcion: e.target.value }))} />
          <div className="sm:col-span-3">
            <Boton type="submit">Crear rol</Boton>
          </div>
        </form>
      </Tarjeta>
    </div>
  );
}
