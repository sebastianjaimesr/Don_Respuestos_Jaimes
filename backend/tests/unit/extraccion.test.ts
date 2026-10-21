import { describe, expect, it } from 'vitest';
import { detectarAnio, detectarCategoria, detectarIntenciones, detectarModelo, detectarOpcion, detectarPosicion, detectarTipo, pareceTarjeta } from '../../src/asistente/extraccion';
import { normalizarTelefono } from '../../src/utils/texto';

const MODELOS = [
  { id: 1, nombre: 'FZ 2.0', alias: ['fz 2.0', 'fz2.0', 'fz 2', 'fz'] },
  { id: 2, nombre: 'FZ 25', alias: ['fz 25', 'fz25', 'fz'] },
  { id: 3, nombre: 'NMAX', alias: ['nmax', 'n max'] },
  { id: 4, nombre: 'MT-03', alias: ['mt 03', 'mt03'] },
];

describe('detección de modelo', () => {
  it('reconoce el modelo exacto', () => {
    expect(detectarModelo('pastillas para fz 2.0 2018', MODELOS)).toMatchObject({ tipo: 'encontrado', modelo: { id: 1 } });
    expect(detectarModelo('tengo una N-MAX', MODELOS)).toMatchObject({ tipo: 'encontrado', modelo: { id: 3 } });
    expect(detectarModelo('mi MT-03', MODELOS)).toMatchObject({ tipo: 'encontrado', modelo: { id: 4 } });
  });
  it('no asume que FZ 2.0 y FZ 25 son la misma moto: "fz" es ambiguo', () => {
    const r = detectarModelo('filtro para la fz', MODELOS);
    expect(r.tipo).toBe('ambiguo');
  });
  it('no confunde un año o un número con un modelo', () => {
    expect(detectarModelo('quiero algo para 2025', MODELOS).tipo).toBe('ninguno');
  });
});

describe('detección de repuesto', () => {
  it('distingue filtro de aceite de aceite de motor', () => {
    expect(detectarCategoria('necesito el filtro de aceite')).toEqual({ tipo: 'encontrada', clave: 'filtro_aceite' });
    expect(detectarCategoria('un litro de aceite')).toEqual({ tipo: 'encontrada', clave: 'aceite_motor' });
  });
  it('pregunta cuando el repuesto es ambiguo', () => {
    expect(detectarCategoria('necesito un filtro')).toMatchObject({ tipo: 'ambigua', opciones: ['filtro_aire', 'filtro_aceite'] });
    expect(detectarCategoria('los frenos')).toMatchObject({ tipo: 'ambigua' });
  });
  it('detecta posición, tipo, año, opción', () => {
    expect(detectarPosicion('las de atrás')).toBe('trasero');
    expect(detectarPosicion('pastillas delanteras')).toBe('delantero');
    expect(detectarTipo('algo genérico, más barato')).toBe('generico');
    expect(detectarTipo('original yamaha')).toBe('original');
    expect(detectarAnio('modelo 2018')).toBe(2018);
    expect(detectarAnio('fz 25')).toBeNull();
    expect(detectarOpcion('la 2')).toBe(2);
    expect(detectarOpcion('el primero')).toBe(1);
  });
});

describe('intenciones y seguridad', () => {
  it('detecta solicitud de asesor y cliente molesto', () => {
    expect(detectarIntenciones('quiero hablar con un asesor').has('humano')).toBe(true);
    expect(detectarIntenciones('esto es un pésimo servicio').has('molesto')).toBe(true);
  });
  it('detecta posibles números de tarjeta', () => {
    expect(pareceTarjeta('mi tarjeta es 4111 1111 1111 1111')).toBe(true);
    expect(pareceTarjeta('mi celular 3001234567')).toBe(false);
  });
  it('normaliza teléfonos colombianos', () => {
    expect(normalizarTelefono('+57 300 123 4567')).toBe('3001234567');
    expect(normalizarTelefono('12345')).toBeNull();
  });
});
