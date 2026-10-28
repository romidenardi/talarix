-- Mesas y comandas (restaurantes). Ver services/table.service.js.
-- Primero lo que se puede repetir sin error (MODIFY y CREATE IF NOT EXISTS) y al final las columnas nuevas.
-- Rol nuevo: mozo (solo usa Mesas).
ALTER TABLE users MODIFY COLUMN role ENUM('admin','editor','operador','mozo') NOT NULL DEFAULT 'operador';
-- Mesas del comercio
CREATE TABLE IF NOT EXISTS dining_tables (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(30) NOT NULL,
  area VARCHAR(50) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dining_tables_business_name (business_id, name)
);
-- Cuenta de una mesa: se abre al sentarse y se cierra al cobrar
CREATE TABLE IF NOT EXISTS table_tabs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  table_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  guests INT NULL,
  waiter_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  waiter_name VARCHAR(100) NULL,
  opened_at DATETIME NOT NULL,
  closed_at DATETIME NULL,
  closed_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  closed_by_name VARCHAR(100) NULL,
  cancel_reason VARCHAR(255) NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_table_tabs_business_status (business_id, status),
  KEY idx_table_tabs_table (table_id)
);
-- Comandas: cada envío a la cocina, con número correlativo por comercio
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  tab_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  number INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ready_at DATETIME NULL,
  request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  created_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  created_by_name VARCHAR(100) NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kitchen_tickets_business_number (business_id, number),
  UNIQUE KEY uq_kitchen_tickets_business_request (business_id, request_id),
  KEY idx_kitchen_tickets_tab (tab_id)
);
-- Platos pedidos en cada comanda
CREATE TABLE IF NOT EXISTS tab_items (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  tab_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ticket_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  note VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  cancelled_at DATETIME NULL,
  cancelled_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  cancelled_by_name VARCHAR(100) NULL,
  cancel_reason VARCHAR(255) NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_tab_items_tab (tab_id),
  KEY idx_tab_items_ticket (ticket_id),
  KEY idx_tab_items_product (product_id)
);
-- Cobros de un remito pagado en partes (cuenta dividida) y la propina de cada parte
CREATE TABLE IF NOT EXISTS order_payments (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  payment_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  tip DECIMAL(12,2) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_payments_order (order_id),
  KEY idx_order_payments_business (business_id)
);
-- El comercio tiene el módulo de mesas (lo activa el superadmin desde /plataforma)
ALTER TABLE businesses ADD COLUMN tables_enabled TINYINT(1) NOT NULL DEFAULT 0;
-- El remito que se generó al cobrar una mesa
ALTER TABLE orders ADD COLUMN table_tab_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
