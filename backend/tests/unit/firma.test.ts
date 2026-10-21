import { describe, expect, it } from 'vitest';
import { firmar, verificarFirma } from '../../src/utils/firma';

describe('firma HMAC de webhooks', () => {
  const secreto = 'x'.repeat(40);
  const ts = () => Math.floor(Date.now() / 1000).toString();
  it('acepta una firma correcta', () => {
    const t = ts();
    expect(verificarFirma(secreto, t, '{"a":1}', firmar(secreto, t, '{"a":1}'))).toBe(true);
  });
  it('rechaza cuerpo alterado, secreto incorrecto o timestamp viejo', () => {
    const t = ts();
    const f = firmar(secreto, t, '{"a":1}');
    expect(verificarFirma(secreto, t, '{"a":2}', f)).toBe(false);
    expect(verificarFirma('y'.repeat(40), t, '{"a":1}', f)).toBe(false);
    const viejo = String(Number(t) - 3600);
    expect(verificarFirma(secreto, viejo, '{"a":1}', firmar(secreto, viejo, '{"a":1}'))).toBe(false);
  });
});
