// Número de remito: correlativo por comercio (00000123). Igual que formatOrderNumber del backend.
export const orderNumberLabel = (order) =>
  order?.number
    ? String(order.number).padStart(8, '0')
    : String(order?.id || '')
        .slice(0, 8)
        .toUpperCase();
