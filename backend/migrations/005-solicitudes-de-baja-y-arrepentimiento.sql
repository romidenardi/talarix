-- Botones de baja y de arrepentimiento (services/serviceRequest.service.js).
-- Cada pedido queda con su código, que se le envía a quien lo hizo. No se borra con la purga del
-- comercio: es la constancia de que se pidió y se atendió.
CREATE TABLE IF NOT EXISTS service_requests (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  code VARCHAR(20) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  business_name VARCHAR(255) NULL,
  reason TEXT NULL,
  business_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  note VARCHAR(500) NULL,
  resolved_at DATETIME NULL,
  ip VARCHAR(64) NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_requests_code (code),
  KEY idx_service_requests_status (status)
);
