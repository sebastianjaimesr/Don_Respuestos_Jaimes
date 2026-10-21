import { describe, expect, it } from 'vitest';
import { aCentavos, aDecimal, formatoCOP } from '../../src/utils/dinero';

describe('dinero (aritmética en centavos)', () => {
  it('convierte NUMERIC de PostgreSQL a centavos sin pasar por float', () => {
    expect(aCentavos('68000.00')).toBe(6_800_000);
    expect(aCentavos('0.1')).toBe(10);
    expect(aCentavos(35000)).toBe(3_500_000);
  });
  it('evita el error clásico 0.1 + 0.2', () => {
    expect(aDecimal(aCentavos('0.10') + aCentavos('0.20'))).toBe('0.30');
  });
  it('formatea en pesos colombianos', () => {
    expect(formatoCOP('68000.00')).toBe('$68.000');
    expect(formatoCOP('1234567.50')).toBe('$1.234.567,50');
  });
  it('rechaza montos inválidos', () => {
    expect(() => aCentavos('-5')).toThrow();
    expect(() => aCentavos('abc')).toThrow();
  });
});
