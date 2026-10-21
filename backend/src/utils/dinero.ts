/**
 * Manejo de dinero en CENTAVOS (enteros) para evitar errores de punto flotante.
 * Ejemplo del problema: 0.1 + 0.2 === 0.30000000000000004 en JavaScript.
 * PostgreSQL devuelve NUMERIC como texto ("68000.00"); lo convertimos a centavos
 * sin pasar por float.
 */
export function aCentavos(valor: string | number): number {
  const texto = typeof valor === 'number' ? valor.toFixed(2) : valor.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) throw new Error(`Monto inválido: ${valor}`);
  const [enteros, dec = ''] = texto.split('.');
  return parseInt(enteros, 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
}

/** Centavos → texto decimal para guardar en NUMERIC ("68000.00"). */
export function aDecimal(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw new Error('Centavos inválidos');
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

/** Formato colombiano: $68.000 (sin decimales si son ,00). */
export function formatoCOP(valor: string | number): string {
  const c = aCentavos(valor);
  const pesos = Math.floor(c / 100);
  const miles = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = c % 100;
  return `$${miles}${dec ? ',' + String(dec).padStart(2, '0') : ''}`;
}
