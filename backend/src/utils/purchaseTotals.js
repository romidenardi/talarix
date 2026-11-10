// Totales de una compra con su IVA (copiado en frontend/src/utils/purchaseTotals.js para la vista
// previa; test/unit/frontendParity.test.js revisa que den lo mismo).
//
// El costo unitario se carga SIN IVA, como figura en la factura del proveedor. Cada renglón se
// redondea a centavos; el IVA se calcula sobre el neto de cada alícuota (como en la factura) y el
// total es neto + IVA.
// lines: [{ quantity, unitCost, vatRate }]
const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);

export const purchaseTotals = (lines) => {
  const netCentsByRate = new Map();
  for (const line of lines) {
    const rate = Number(line.vatRate) || 0;
    const lineCents = cents((Number(line.quantity) || 0) * (Number(line.unitCost) || 0));
    netCentsByRate.set(rate, (netCentsByRate.get(rate) || 0) + lineCents);
  }

  const byRate = [...netCentsByRate.entries()]
    .map(([rate, netCents]) => ({ rate, netCents, vatCents: Math.round((netCents * rate) / 100) }))
    .sort((a, b) => b.rate - a.rate);

  const subtotalCents = byRate.reduce((sum, r) => sum + r.netCents, 0);
  const vatCents = byRate.reduce((sum, r) => sum + r.vatCents, 0);
  return {
    byRate: byRate.map((r) => ({
      rate: r.rate,
      net: r.netCents / 100,
      vat: r.vatCents / 100,
      total: (r.netCents + r.vatCents) / 100,
    })),
    subtotal: subtotalCents / 100,
    vatAmount: vatCents / 100,
    total: (subtotalCents + vatCents) / 100,
  };
};
