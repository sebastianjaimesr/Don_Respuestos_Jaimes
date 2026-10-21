-- Configuración comercial inicial (sección 11 del prompt maestro).
-- Los datos que el propietario aún no ha confirmado quedan con confirmado = false
-- y valor NULL: la aplicación los muestra como "pendiente de confirmar".
INSERT INTO configuracion_negocio (clave, valor, descripcion, confirmado) VALUES
  ('nombre',             '"Don Repuestos Jaimes"', 'Nombre comercial', true),
  ('pais',               '"Colombia"', 'País de operación', true),
  ('moneda',             '"COP"', 'Moneda', true),
  ('horario',            '"Lunes a sábado, de 8:00 a. m. a 6:00 p. m."', 'Horario de atención', true),
  ('direccion',          NULL, 'Dirección del local', false),
  ('ciudades_envio',     NULL, 'Ciudades a las que se envía', false),
  ('transportadoras',    NULL, 'Transportadoras habilitadas', false),
  ('costo_envio',        NULL, 'Costo de envío (número en COP o tabla por ciudad)', false),
  ('medios_pago',        '["nequi","daviplata","transferencia","efectivo","contraentrega"]', 'Medios de pago aceptados', false),
  ('contacto_humano',    NULL, 'Teléfono o canal de contacto con un asesor', false),
  ('vigencia_cotizacion_dias', '3', 'Días de vigencia de una cotización', false)
ON CONFLICT (clave) DO NOTHING;
