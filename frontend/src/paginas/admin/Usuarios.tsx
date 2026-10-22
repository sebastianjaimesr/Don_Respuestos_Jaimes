import { useState, type FormEvent } from 'react';
import { apiAdmin } from '../../api/cliente';
import { etiqueta, fecha } from '../../api/formato';
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

export default function Usuarios() {
  const lista = useCarga(() => apiAdmin<Usuario[]>('/admin/asesores'), []);
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'vendedor' });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    try {
      await apiAdmin('/admin/asesores', 'POST', f);
      setOk(`Usuario ${f.email} creado.`);
      setF({ nombre: '', email: '', password: '', rol: 'vendedor' });
      void lista.recargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };
  const alternar = async (u: Usuario) => {
    setError(null);
    try {
      await apiAdmin(`/admin/asesores/${u.id}`, 'PATCH', { activo: !u.activo });
      void lista.recargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <>
      <Titulo>Usuarios del panel</Titulo>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Tarjeta titulo="Usuarios">
          {error && <Alerta>{error}</Alerta>}
          {!lista.datos ? (
            <Cargando />
          ) : (
            <Tabla columnas={['Nombre', 'Rol', 'Último acceso', 'Estado', '']}>
              {lista.datos.map((u) => (
                <tr key={u.id}>
                  <td className="px-2 py-2">
                    {u.nombre}
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-2 py-2">{etiqueta(u.rol)}</td>
                  <td className="px-2 py-2">{fecha(u.ultimo_acceso)}</td>
                  <td className="px-2 py-2">{u.activo ? <Insignia color="verde" texto="Activo" /> : <Insignia color="gris" texto="Inactivo" />}</td>
                  <td className="px-2 py-2 text-right">
                    <Boton tamano="sm" variante="secundario" onClick={() => alternar(u)}>
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </Boton>
                  </td>
                </tr>
              ))}
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
              <option value="vendedor">Vendedor: pedidos, inventario y atención</option>
              <option value="consulta">Solo consulta</option>
              <option value="admin">Administrador: todo, incluidos precios</option>
            </Selector>
            <Boton type="submit">Crear usuario</Boton>
          </form>
        </Tarjeta>
      </div>
    </>
  );
}
