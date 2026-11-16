-- Recargo por mora (interés punitorio) en la cuenta corriente de clientes. Ver
-- services/customerInstallment.service.js y utils/accountInstallments.js (lateFee).
--   - businesses.late_fee_rate: % mensual que cobra el comercio por las cuotas vencidas; NULL = no
--     cobra recargo. late_fee_grace_days: días después del vencimiento sin recargo.
--   - orders.late_fee_rate / late_fee_grace_days: la tasa vigente cuando se hizo el remito a cuenta
--     corriente. Con esa cobran sus cuotas y es la que imprime la leyenda. NULL: no había tasa (no
--     cobra recargo). Los remitos anteriores a esta migración quedan sin tasa.
--   - El recargo no se guarda mientras la cuota está impaga: se calcula a la fecha. Al cobrar, queda
--     en la cuota (customer_installments.late_fee) y en la cobranza: late_fee lo cobrado y
--     late_fee_computed lo calculado (la diferencia es lo que se perdonó).
-- Solo columnas nuevas, sin datos que mover.
ALTER TABLE businesses ADD COLUMN late_fee_rate DECIMAL(5,2) NULL;
ALTER TABLE businesses ADD COLUMN late_fee_grace_days INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN late_fee_rate DECIMAL(5,2) NULL;
ALTER TABLE orders ADD COLUMN late_fee_grace_days INT NULL;
ALTER TABLE customer_installments ADD COLUMN late_fee DECIMAL(12,2) NULL;
ALTER TABLE customer_payments ADD COLUMN late_fee DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE customer_payments ADD COLUMN late_fee_computed DECIMAL(12,2) NOT NULL DEFAULT 0;
