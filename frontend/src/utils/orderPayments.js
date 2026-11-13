// Formas de pago de un remito. Una cuenta de mesa cobrada en partes trae `payments` (una por parte,
// con su forma de pago e importe); el resto se cobró entero con `Payment`.
export const paymentParts = (order) => (Array.isArray(order?.payments) ? order.payments : []);

export const paymentLabel = (order) => {
  // A cuenta corriente no hay forma de pago: se cobra después
  if (order?.paymentCondition === 'account') return 'Cuenta corriente';
  const parts = paymentParts(order);
  if (!parts.length) return order?.Payment?.name || '—';
  return [...new Set(parts.map((p) => p.Payment?.name || 'Sin forma de pago.'))].join(' + ');
};
