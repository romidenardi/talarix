-- Insumos y servicios.
-- Insumos: productos que se compran y llevan stock pero no se venden (envases, limpieza, materia
-- prima). Se marcan con is_supply y no aparecen en Productos, remitos ni combos.
ALTER TABLE products ADD COLUMN is_supply TINYINT(1) NOT NULL DEFAULT 0;
-- Servicios y gastos de una compra (alquiler, luz, fletes): concepto libre, sin producto ni stock
CREATE TABLE IF NOT EXISTS purchase_expenses (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  purchase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  description VARCHAR(150) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  vat_rate DECIMAL(5,2) NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_purchase_expenses_purchase (purchase_id)
);
