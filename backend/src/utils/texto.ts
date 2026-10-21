/** Minúsculas, sin tildes, guiones/barras como espacios y espacios colapsados. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/[¿?¡!,;:()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ¿El texto contiene la frase como palabras completas? */
export function contieneFrase(textoNormalizado: string, frase: string): boolean {
  return new RegExp(`(^|\\s)${escaparRegex(frase)}(?=$|\\s|\\.(\\s|$))`).test(textoNormalizado);
}

/** Teléfono colombiano → solo dígitos, sin indicativo +57. Devuelve null si no es válido. */
export function normalizarTelefono(entrada: string): string | null {
  let d = entrada.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  if (/^3\d{9}$/.test(d)) return d; // celular
  if (/^60\d{8}$/.test(d)) return d; // fijo con indicativo regional (desde 2021)
  return null;
}

/** Oculta datos personales para registros: 3001234567 → 300****567 */
export function enmascarar(valor: string): string {
  if (valor.length <= 6) return '***';
  return valor.slice(0, 3) + '*'.repeat(valor.length - 6) + valor.slice(-3);
}
