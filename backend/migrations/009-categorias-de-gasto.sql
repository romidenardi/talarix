-- Categoría de gasto de cada servicio de una compra (alquiler, servicios, fletes...), para el
-- reporte de Gastos. Los servicios cargados antes quedan sin categoría (NULL).
ALTER TABLE purchase_expenses ADD COLUMN category VARCHAR(40) NULL;
