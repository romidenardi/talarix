-- Vencimiento automático de la prueba gratis.
-- Por qué está suspendido un comercio: 'trial_expired' (venció la prueba; lo suspende la tarea
-- programada y se reactiva solo al renovar) o 'manual' (lo suspendió el superadmin). NULL si está activo.
ALTER TABLE businesses ADD COLUMN suspended_reason VARCHAR(20) NULL;
