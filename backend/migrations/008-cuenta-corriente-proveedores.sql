-- Cuenta corriente con proveedores.
-- Cada compra es al contado (cash) o a cuenta corriente (account). Las de cuenta corriente suman a
-- lo que se le debe al proveedor; los pagos lo descuentan (se aplican a la deuda total, no a una
-- factura). Las compras anteriores quedan al contado.
ALTER TABLE purchases ADD COLUMN payment_condition VARCHAR(20) NOT NULL DEFAULT 'cash';
-- Lo que se le debía al proveedor al empezar a usar el sistema (positivo: se le debe)
ALTER TABLE suppliers ADD COLUMN opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS supplier_payments (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  supplier_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
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
  UNIQUE KEY uq_supplier_payments_business_request (business_id, request_id),
  KEY idx_supplier_payments_supplier (business_id, supplier_id)
);
