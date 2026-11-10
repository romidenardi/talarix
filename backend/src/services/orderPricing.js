import { splitPrice, splitLineParts } from '../utils/taxes.js';
import { round2 } from '../utils/numbers.js';
import { httpError } from '../utils/httpError.js';

// Cálculo de un remito, sin base de datos (se prueba en test/unit/orderPricing.test.js).
// Lo usan la creación de remitos y los datos de la cuenta demo, así que no pueden calcular distinto.
//
// Reglas:
// - El precio unitario se redondea a 2 decimales ANTES de calcular (es lo que se guarda y se imprime).
// - Cada renglón se redondea a centavos y el total es la suma de los renglones: el remito impreso
//   siempre cierra (10,333 × 3 → precio 10,33 → renglón 30,99 → total 30,99).
// - Los descuentos se aplican sobre el total; el IVA y los impuestos internos se escalan en proporción.

export const FISCAL_CONDITIONS_WITH_VAT_BREAKDOWN = ['Responsable Inscripto'];
export const discriminatesVatFor = (fiscalCondition) => FISCAL_CONDITIONS_WITH_VAT_BREAKDOWN.includes(fiscalCondition);

// lines: [{ quantity, unitPrice, vatRate, otherTaxes, components? }]
//   components (combos): [{ price, quantity, vatRate, otherTaxes }]
// plan: { installments, interestRate } o null
export const priceOrder = ({
  lines,
  discountPercent = 0,
  discountAmount = 0,
  discriminatesVat = false,
  plan = null,
}) => {
  let grossSubtotal = 0;
  let grossVat = 0;
  let grossInternal = 0;
  let grossCents = 0;

  const lineTotals = lines.map((line) => {
    const unitPrice = round2(Number(line.unitPrice) || 0);
    const lineTotal = round2(Number(line.quantity) * unitPrice);
    const parts =
      Array.isArray(line.components) && line.components.length
        ? splitLineParts(lineTotal, line.components)
        : [splitPrice(lineTotal, line.vatRate, line.otherTaxes)];
    for (const part of parts) {
      grossSubtotal += part.net;
      grossVat += part.vat;
      grossInternal += part.internal;
    }
    grossCents += Math.round(lineTotal * 100);
    return lineTotal;
  });

  const grossTotal = grossCents / 100;
  const percent = Number(discountPercent) || 0;
  const amount = Number(discountAmount) || 0;
  const totalDiscount = round2(grossTotal * (percent / 100) + amount);
  if (totalDiscount > grossTotal + 0.005) {
    throw httpError('El descuento no puede ser mayor al total del remito.');
  }

  const total = round2(grossTotal - totalDiscount);
  const scale = grossTotal > 0 ? total / grossTotal : 1;

  const result = {
    lineTotals,
    grossTotal,
    totalDiscount,
    total,
    subtotal: discriminatesVat ? round2(grossSubtotal * scale) : null,
    vatAmount: discriminatesVat ? round2(grossVat * scale) : null,
    internalTaxAmount: discriminatesVat ? round2(grossInternal * scale) : null,
    installmentsCount: null,
    interestRate: null,
    installmentAmount: null,
    totalFinanced: null,
  };

  if (plan) {
    result.installmentsCount = plan.installments;
    result.interestRate = Number(plan.interestRate);
    result.totalFinanced = round2(total * (1 + result.interestRate / 100));
    result.installmentAmount = round2(result.totalFinanced / plan.installments);
  }
  return result;
};

const parseComponents = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// Desglose del IVA por alícuota de un remito ya guardado (para imprimirlo). Reparte igual que
// priceOrder: cada renglón con su alícuota (los combos, cada producto con la suya) y escalado por
// los descuentos. La diferencia de centavos por redondeo va a la alícuota con más IVA, así la suma
// da exactamente el IVA y el subtotal guardados en el remito.
// items: [{ quantity, unitPrice, vatRate, otherTaxes, components }] (vatRate null = remito anterior
// a esa columna: se usa fallbackVatRate / fallbackOtherTaxes, los actuales del producto)
export const vatBreakdown = ({ items, grossTotal, total, subtotal, vatAmount }) => {
  const byRate = new Map();
  let sumGross = 0;
  for (const item of items) {
    const lineTotal = round2(Number(item.quantity) * round2(Number(item.unitPrice) || 0));
    sumGross += lineTotal;
    const components = parseComponents(item.components);
    const vatRate = item.vatRate ?? item.fallbackVatRate;
    const otherTaxes = item.vatRate != null ? item.otherTaxes : item.fallbackOtherTaxes;
    const parts =
      Array.isArray(components) && components.length
        ? splitLineParts(lineTotal, components)
        : [{ vatRate: Number(vatRate) || 0, ...splitPrice(lineTotal, vatRate, otherTaxes) }];
    for (const part of parts) {
      const row = byRate.get(part.vatRate) || { rate: part.vatRate, net: 0, vat: 0 };
      row.net += part.net;
      row.vat += part.vat;
      byRate.set(part.vatRate, row);
    }
  }

  const gross = Number(grossTotal) > 0 ? Number(grossTotal) : sumGross;
  const scale = gross > 0 ? Number(total) / gross : 1;
  const rows = [...byRate.values()]
    .map((r) => ({ rate: r.rate, net: round2(r.net * scale), vat: round2(r.vat * scale) }))
    .sort((a, b) => b.rate - a.rate);
  if (!rows.length) return rows;

  const biggest = rows.reduce((max, r) => (r.vat > max.vat ? r : max), rows[0]);
  if (vatAmount != null) {
    biggest.vat = round2(biggest.vat + Number(vatAmount) - rows.reduce((sum, r) => sum + r.vat, 0));
  }
  if (subtotal != null) {
    biggest.net = round2(biggest.net + Number(subtotal) - rows.reduce((sum, r) => sum + r.net, 0));
  }
  return rows;
};
