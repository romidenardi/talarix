-- Cuenta corriente de clientes (ver services/customerAccount.service.js).
-- Cada remito es al contado (cash) o a cuenta corriente (account). Los de cuenta corriente suman a lo
-- que debe el cliente y no llevan forma de pago (payment_id queda NULL); las cobranzas lo descuentan
-- (se aplican a la deuda total, no a un remito). Los remitos anteriores quedan al contado.
-- Primero lo que se puede repetir sin error (CREATE IF NOT EXISTS y MODIFY) y al final las columnas nuevas.
CREATE TABLE IF NOT EXISTS customer_payments (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  customer_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payment_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  date DATETIME NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  cancelled_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  cancelled_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  cancelled_by_name VARCHAR(100) NULL,
  created_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  created_by_name VARCHAR(100) NULL,
  request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_payments_business_request (business_id, request_id),
  KEY idx_customer_payments_customer (business_id, customer_id)
);
-- Un remito a cuenta corriente no tiene forma de pago. Mismo tipo con el que la creó el modelo
-- (CHAR(36) BINARY), así la clave foránea hacia payments sigue valiendo; solo deja de ser obligatoria.
ALTER TABLE orders MODIFY COLUMN payment_id CHAR(36) BINARY NULL;
ALTER TABLE orders ADD COLUMN payment_condition VARCHAR(20) NOT NULL DEFAULT 'cash';
-- Lo que debía el cliente al empezar a usar el sistema (positivo: el cliente debe)
ALTER TABLE customers ADD COLUMN opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0;
