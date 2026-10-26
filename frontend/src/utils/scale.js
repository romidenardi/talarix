import { round3 } from './quantity.js';

// Mismo formato de fábrica que las balanzas Systel (EAN-13):
//   2 0 | 0 4 1 7 | 6 4 2 6 0 0 | 6
//   prefijo | PLU (4) | valor (6) | dígito de control
export const DEFAULT_SCALE_CONFIG = {
  enabled: false,
  prefix: '20',
  pluStart: 3,
  pluLength: 4,
  valueStart: 7,
  valueLength: 6,
  valueType: 'quantity', // 'quantity' = peso (CANTID), 'amount' = importe (TOTAL)
  decimals: 3,
  checkDigit: true,
};

export const resolveScaleConfig = (stored) => ({
  ...DEFAULT_SCALE_CONFIG,
  ...(stored && typeof stored === 'object' ? stored : {}),
});

// Dígito de control EAN-13: pesos 1 y 3 alternados sobre los primeros 12 dígitos
export const ean13CheckDigit = (first12) => {
  const sum = String(first12)
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
};

const slice = (code, start, length) => code.slice(start - 1, start - 1 + length);

export const parseScaleCode = (rawCode, config) => {
  const cfg = resolveScaleConfig(config);
  if (!cfg.enabled) return null;

  const code = String(rawCode || '').trim();
  if (!/^\d{13}$/.test(code)) return null;
  if (cfg.prefix && !code.startsWith(cfg.prefix)) return null;
  if (cfg.checkDigit && ean13CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null;

  const plu = Number(slice(code, Number(cfg.pluStart), Number(cfg.pluLength)));
  const rawValue = Number(slice(code, Number(cfg.valueStart), Number(cfg.valueLength)));
  if (!Number.isFinite(plu) || !Number.isFinite(rawValue)) return null;

  const value = rawValue / 10 ** Number(cfg.decimals);
  return { code, plu, value, valueType: cfg.valueType };
};

// Cantidad e importe de la línea a partir de la etiqueta y del producto con ese PLU.
// - Etiqueta con peso: cantidad = peso.
// - Etiqueta con importe: cantidad = importe / precio del sistema. Si el precio de la balanza
//   es distinto al del sistema, "priceMismatch" avisa (más allá del redondeo a gramos).
export const lineFromLabel = (label, product) => {
  const price = Number(product?.price) || 0;
  if (label.valueType === 'quantity') {
    return { quantity: round3(label.value), amount: round3(label.value) * price, priceMismatch: false };
  }
  if (price <= 0) return { quantity: 0, amount: label.value, priceMismatch: true, noPrice: true };
  const quantity = round3(label.value / price);
  const computed = quantity * price;
  const tolerance = price * 0.0005 + 0.01;
  return { quantity, amount: label.value, priceMismatch: Math.abs(computed - label.value) > tolerance };
};
