-- Comisiones por venta (opcionales, por usuario). Ver services/commission.service.js.
-- users.commission_rate: % de comisión del usuario; NULL = sin comisión.
-- En cada remito queda una foto de la comisión al momento de la venta: quién vendió (el que lo hizo,
-- o en una mesa el mozo que la atendió), su % y el importe sobre el total final. Si después se cambia
-- el % del usuario, los remitos anteriores no cambian. Los remitos anteriores quedan sin vendedor.
ALTER TABLE users ADD COLUMN commission_rate DECIMAL(5,2) NULL;
ALTER TABLE orders ADD COLUMN seller_id CHAR(36) BINARY NULL;
ALTER TABLE orders ADD COLUMN seller_name VARCHAR(100) NULL;
ALTER TABLE orders ADD COLUMN commission_rate DECIMAL(5,2) NULL;
ALTER TABLE orders ADD COLUMN commission_amount DECIMAL(12,2) NULL;
