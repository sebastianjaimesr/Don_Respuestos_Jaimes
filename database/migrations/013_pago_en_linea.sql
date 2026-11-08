-- Fase 7: el cliente puede elegir "pago en línea" (Wompi) al registrar el pedido.
-- El pedido sigue con estado_pago = 'pendiente' hasta que llegue el evento firmado
-- de la pasarela o un asesor registre el pago.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_metodo_pago_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_metodo_pago_check
  CHECK (metodo_pago IN ('nequi', 'daviplata', 'transferencia', 'efectivo', 'contraentrega', 'en_linea'));
