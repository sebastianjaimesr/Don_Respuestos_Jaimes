import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../api/auth';
import { Alerta, Boton, Campo, mensajeError } from '../../componentes/ui';

export default function Login() {
  const { usuario, entrar } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (usuario) return <Navigate to="/admin" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await entrar(email, password);
      nav((loc.state as { desde?: string })?.desde ?? '/admin', { replace: true });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center p-4">
      <form onSubmit={enviar} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-2xl" aria-hidden>
            🏍️
          </p>
          <h1 className="text-lg font-semibold">Panel de Don Repuestos Jaimes</h1>
          <p className="text-sm text-slate-500">Acceso solo para personal autorizado.</p>
        </div>
        {error && <Alerta>{error}</Alerta>}
        <Campo etiqueta="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <Campo etiqueta="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        <Boton type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </Boton>
        <Link to="/" className="text-center text-sm text-marca-700 hover:underline">
          Ir al chat de clientes
        </Link>
      </form>
    </div>
  );
}
