// Identificador que manda el frontend con cada remito o compra. Si el mismo pedido llega dos veces
// (doble clic, reintento por un corte de red), el servidor devuelve el que ya creó en lugar de
// crear otro. Es único por comercio (índice uq_orders_business_request / uq_purchases_business_request).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const cleanRequestId = (value) =>
  typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;

export const isDuplicateRequest = (err) =>
  err?.name === 'SequelizeUniqueConstraintError' &&
  /request_id|requestId|_request/i.test(
    `${err?.parent?.sqlMessage || ''} ${err?.original?.sqlMessage || ''} ${Object.keys(err?.fields || {}).join(' ')}`,
  );
