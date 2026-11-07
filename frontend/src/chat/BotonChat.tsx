import type { ButtonHTMLAttributes } from 'react';

/** Botón del asistente: primario con degradado eléctrico o secundario en vidrio. */
export function BotonChat({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' }) {
  const estilo =
    variante === 'primario'
      ? 'bg-gradient-to-br from-electrico-400 to-electrico-600 text-white shadow-[0_8px_20px_-8px_rgba(37,99,255,0.9)] hover:brightness-110'
      : 'border border-white/15 bg-white/[0.04] text-slate-100 hover:border-electrico-400/50 hover:bg-white/[0.08]';
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${estilo} ${className}`}
    />
  );
}
