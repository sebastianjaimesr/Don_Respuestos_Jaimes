import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useTienda } from '../estado';
import { Boton, Campo, Contenedor, cx, erroresPorCampo, mensajeError } from '../ui';

/** Ingreso y registro de clientes. La sesión queda en una cookie HttpOnly. */
export default function PaginaIngresar() {
  const { cliente, verificandoSesion, ingresar, registrarse } = useTienda();
  const navegar = useNavigate();
  const [modo, setModo] = useState<'ingresar' | 'registro'>('ingresar');
  const [f, setF] = useState({ nombre: '', email: '', telefono: '', ciudad: '', password: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  if (!verificandoSesion && cliente) return <Navigate to="/cuenta" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErrores({});
    setError(null);
    if (modo === 'registro' && f.password.length < 10) return setErrores({ password: 'Usa al menos 10 caracteres' });
    setEnviando(true);
    try {
      if (modo === 'ingresar') await ingresar(f.email.trim(), f.password);
      else await registrarse({ nombre: f.nombre, email: f.email.trim(), telefono: f.telefono, password: f.password, ciudad: f.ciudad || undefined });
      navegar('/cuenta', { replace: true });
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      setError(Object.keys(porCampo).length ? 'Revisa los campos marcados.' : mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Contenedor className="max-w-md py-10">
      <div className="vidrio rounded-3xl p-6 sm:p-8">
        <div role="tablist" aria-label="Tipo de acceso" className="mb-6 grid grid-cols-2 rounded-xl bg-white/[0.04] p-1">
          {(
            [
              ['ingresar', 'Ingresar'],
              ['registro', 'Crear cuenta'],
            ] as const
          ).map(([v, t]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={modo === v}
              onClick={() => {
                setModo(v);
                setErrores({});
                setError(null);
              }}
              className={cx('rounded-lg py-2.5 text-sm font-semibold transition', modo === v ? 'bg-electrico-500 text-white' : 'text-gris-tec hover:text-white')}
            >
              {t}
            </button>
          ))}
        </div>
        <form onSubmit={enviar} noValidate className="space-y-4">
          {modo === 'registro' && (
            <>
              <Campo id="cu-nombre" etiqueta="Nombre" autoComplete="name" required value={f.nombre} onChange={cambiar('nombre')} error={errores.nombre} />
              <Campo id="cu-tel" etiqueta="Celular" type="tel" inputMode="tel" autoComplete="tel" required value={f.telefono} onChange={cambiar('telefono')} error={errores.telefono} />
              <Campo id="cu-ciudad" etiqueta="Ciudad (opcional)" autoComplete="address-level2" value={f.ciudad} onChange={cambiar('ciudad')} error={errores.ciudad} />
            </>
          )}
          <Campo id="cu-email" etiqueta="Correo" type="email" autoComplete="email" required value={f.email} onChange={cambiar('email')} error={errores.email} />
          <Campo
            id="cu-pass"
            etiqueta="Contraseña"
            type="password"
            autoComplete={modo === 'ingresar' ? 'current-password' : 'new-password'}
            required
            value={f.password}
            onChange={cambiar('password')}
            error={errores.password}
            ayuda={modo === 'registro' ? 'Mínimo 10 caracteres.' : undefined}
          />
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <Boton type="submit" cargando={enviando} className="w-full py-3">
            {modo === 'ingresar' ? 'Ingresar' : 'Crear cuenta'}
          </Boton>
          <p className="text-xs text-gris-tec">No necesitas cuenta para comprar. Con ella puedes ver tus pedidos y guardar favoritos.</p>
        </form>
      </div>
    </Contenedor>
  );
}
