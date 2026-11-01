-- Menú de las mesas: platos y adicionales (services/menu.service.js).
-- Platos y adicionales son productos con menu_kind = 'dish' o 'extra' y sin control de stock.
-- Qué adicionales se pueden pedir con cada plato (un adicional sirve para varios platos)
CREATE TABLE IF NOT EXISTS menu_item_extras (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  dish_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  extra_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_menu_item_extras_dish_extra (dish_id, extra_id),
  KEY idx_menu_item_extras_business (business_id)
);
ALTER TABLE products ADD COLUMN menu_kind VARCHAR(10) NULL;
-- 0 = no lleva stock (platos y adicionales del menú): no se mueve al vender ni al anular
ALTER TABLE products ADD COLUMN track_stock TINYINT(1) NOT NULL DEFAULT 1;
-- Un adicional pedido va como renglón propio, colgado del plato
ALTER TABLE tab_items ADD COLUMN parent_item_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE tab_items ADD COLUMN position INT NOT NULL DEFAULT 0;
