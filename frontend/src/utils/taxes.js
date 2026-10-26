export const VAT_OPTIONS = [
  { value: '21', label: '21%' },
  { value: '10.5', label: '10,5%' },
  { value: '0', label: '0%' },
];

export const formatRate = (rate) => `${String(Number(rate)).replace('.', ',')}%`;

export const vatToFormValue = (rate) =>
  rate === undefined || rate === null || rate === '' ? '21' : String(Number(rate));

export const toPercentOrNull = (value) =>
  value === '' || value === null || value === undefined ? null : Number(value);

export const splitPrice = (total, vatRate, internalRate) => {
  const vat = Number(vatRate) || 0;
  const internal = Number(internalRate) || 0;
  const divisor = 1 + (vat + internal) / 100;
  const net = divisor > 1 ? total / divisor : total;
  return {
    net,
    vat: (net * vat) / 100,
    internal: (net * internal) / 100,
  };
};

export const splitLineParts = (itemTotal, components) => {
  let weights = components.map((c) => (Number(c.price) || 0) * (Number(c.quantity) || 0));
  let totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    weights = components.map((c) => Number(c.quantity) || 1);
    totalWeight = weights.reduce((sum, w) => sum + w, 0);
  }
  return components.map((c, index) => {
    const total = totalWeight > 0 ? (itemTotal * weights[index]) / totalWeight : 0;
    return { total, ...splitPrice(total, c.vatRate, c.otherTaxes) };
  });
};
