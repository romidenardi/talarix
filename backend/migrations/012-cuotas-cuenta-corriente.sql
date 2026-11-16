-- Cuotas en la cuenta corriente de clientes (ver services/customerInstallment.service.js).
-- Cada remito a cuenta corriente se divide en cuotas con su vencimiento (customer_installments). El
-- saldo inicial positivo de un cliente es una cuota más (order_id NULL). Las cobranzas pagan cuotas
-- completas: la cuota guarda qué cobranza la pagó (customer_payment_id) y cuándo (paid_at).
-- Primero lo que se puede repetir sin error y al final la columna nueva.
CREATE TABLE IF NOT EXISTS customer_installments (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  customer_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  number INT NOT NULL,
  installments_count INT NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  customer_payment_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  paid_at DATETIME NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_customer_installments_customer (business_id, customer_id, status),
  KEY idx_customer_installments_order (order_id),
  KEY idx_customer_installments_payment (customer_payment_id)
);
-- Lo que ya había: cada remito a cuenta corriente activo es una cuota única que vence el día de la venta
INSERT INTO customer_installments
  (id, business_id, customer_id, order_id, number, installments_count, due_date, amount, status, createdAt, updatedAt)
SELECT UUID(), o.business_id, o.customer_id, o.id, 1, 1, DATE(o.date), COALESCE(o.total_financed, o.total), 'active', NOW(), NOW()
FROM orders o
WHERE o.payment_condition = 'account' AND o.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM customer_installments i WHERE i.order_id = o.id);
-- El saldo inicial positivo, una cuota que vence hoy
INSERT INTO customer_installments
  (id, business_id, customer_id, order_id, number, installments_count, due_date, amount, status, createdAt, updatedAt)
SELECT UUID(), c.business_id, c.id, NULL, 1, 1, CURDATE(), c.opening_balance, 'active', NOW(), NOW()
FROM customers c
WHERE c.opening_balance > 0
  AND NOT EXISTS (SELECT 1 FROM customer_installments i WHERE i.customer_id = c.id AND i.order_id IS NULL);
-- Las cobranzas que ya había se aplican a las cuotas más viejas, mientras alcancen para cuotas completas
UPDATE customer_installments i
JOIN (
  SELECT x.id, x.running, p.paid
  FROM (
    SELECT i2.id, i2.customer_id,
      SUM(i2.amount) OVER (PARTITION BY i2.customer_id ORDER BY i2.due_date, i2.createdAt, i2.id) AS running
    FROM customer_installments i2
    WHERE i2.status = 'active'
  ) x
  JOIN (
    SELECT customer_id, SUM(amount) AS paid FROM customer_payments WHERE status = 'active' GROUP BY customer_id
  ) p ON p.customer_id = x.customer_id
) paid ON paid.id = i.id
SET i.paid_at = NOW()
WHERE i.paid_at IS NULL AND paid.running <= paid.paid + 0.005;
-- Día del mes en que vencen las cuotas de un remito a cuenta corriente
ALTER TABLE orders ADD COLUMN account_due_day TINYINT NULL;
