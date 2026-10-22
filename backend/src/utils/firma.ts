import crypto from 'node:crypto';

/**
 * Firma HMAC-SHA256 de webhooks: firma = HMAC(secreto, `${timestamp}.${cuerpo}`).
 * Incluir el timestamp evita que alguien reenvíe (replay) un mensaje viejo.
 */
export function firmar(secreto: string, timestamp: string, cuerpo: string): string {
  return crypto.createHmac('sha256', secreto).update(`${timestamp}.${cuerpo}`).digest('hex');
}

export function verificarFirma(secreto: string, timestamp: string, cuerpo: string, firmaRecibida: string, toleranciaSeg = 300): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranciaSeg) return false;
  const esperada = Buffer.from(firmar(secreto, timestamp, cuerpo), 'hex');
  const recibida = Buffer.from(firmaRecibida.replace(/^sha256=/, ''), 'hex');
  // timingSafeEqual: compara en tiempo constante (evita ataques de tiempo)
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

/**
 * Envía un JSON firmado a una URL externa (n8n).
 * Devuelve true solo si respondió 2xx con { "recibido": true }: así no confundimos
 * "n8n contestó algo" con "n8n procesó el aviso" (n8n responde 200 vacío aunque el flujo falle).
 */
export async function enviarFirmado(url: string, secreto: string, datos: unknown, timeoutMs = 5000): Promise<boolean> {
  const cuerpo = JSON.stringify(datos);
  const ts = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-drj-timestamp': ts, 'x-drj-firma': firmar(secreto, ts, cuerpo) },
    body: cuerpo,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return false;
  const respuesta = (await res.json().catch(() => null)) as { recibido?: unknown } | null;
  return respuesta?.recibido === true;
}
