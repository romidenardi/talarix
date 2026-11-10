-- IVA de las compras (reportes de IVA compras y de posición de IVA).
-- Cada renglón guarda su alícuota; el costo unitario se carga sin IVA. La compra guarda el neto
-- (subtotal) y el IVA; el total pasa a ser neto + IVA. Las compras anteriores quedan con NULL:
-- no tienen IVA cargado y los reportes las muestran aparte.
ALTER TABLE purchase_items ADD COLUMN vat_rate DECIMAL(5,2) NULL;
ALTER TABLE purchases ADD COLUMN subtotal DECIMAL(12,2) NULL;
ALTER TABLE purchases ADD COLUMN vat_amount DECIMAL(12,2) NULL;
