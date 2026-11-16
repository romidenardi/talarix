export const toNumber = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

export const toNumberOrZero = (v) => (v === undefined || v === null || v === '' ? 0 : toNumber(v));

export const isPositiveInt = (v) => {
  const n = toNumber(v);
  return Number.isInteger(n) && n > 0;
};

export const isNonNegative = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 0;
};

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const MAX_QUANTITY = 999999999;

export const hasMaxThreeDecimals = (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

export const isPositiveQuantity = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n > 0 && n < MAX_QUANTITY && hasMaxThreeDecimals(n);
};

export const isNonNegativeQuantity = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 0 && n < MAX_QUANTITY && hasMaxThreeDecimals(n);
};

export const quantityAllowedFor = (product, quantity) => product.unitType === 'weight' || Number.isInteger(quantity);

export const unitWord = (product) => (product.unitType === 'weight' ? 'kg' : 'unidades');

// Importe en pesos como se escribe en la Argentina: $1.234,56 (punto para los miles, coma para los
// decimales). Para los mensajes que ve el usuario.
const pesos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatMoney = (n) => `$${pesos.format(Number(n) || 0)}`;
