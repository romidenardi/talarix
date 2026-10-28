-- Productos con variantes (talle, color, sabor…).
-- Producto principal: variant_attributes = ["Talle","Color"] (hasta 3). No se vende, no se compra y no tiene stock.
-- Variante: parent_id = el principal y variant_values = ["M","Rojo"], en el orden de los atributos.
-- own_price = 1 si la variante tiene precio propio; si no, toma el precio y la promo del principal.
-- parent_id va sin clave foránea, igual que en una base nueva (la relación la controla la app).
ALTER TABLE products ADD COLUMN parent_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE products ADD COLUMN variant_attributes JSON NULL;
ALTER TABLE products ADD COLUMN variant_values JSON NULL;
ALTER TABLE products ADD COLUMN own_price TINYINT(1) NOT NULL DEFAULT 0;
CREATE INDEX idx_products_parent ON products (parent_id);
