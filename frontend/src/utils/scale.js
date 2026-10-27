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

// Lee una etiqueta y, si no se puede, dice por qué:
//   { label: { code, plu, value, valueType } }
//   { error: 'disabled' | 'format' | 'prefix' | 'positions' }  → no es una etiqueta de balanza
//   { error: 'checkDigit', expected, found }                    → es de balanza, pero se leyó mal
export const readScaleCode = (rawCode, config) => {
  const cfg = resolveScaleConfig(config);
  if (!cfg.enabled) return { error: 'disabled' };

  const code = String(rawCode || '').trim();
  if (!/^\d{13}$/.test(code)) return { error: 'format' };
  if (cfg.prefix && !code.startsWith(cfg.prefix)) return { error: 'prefix' };
  if (cfg.checkDigit) {
    const expected = ean13CheckDigit(code.slice(0, 12));
    const found = Number(code[12]);
    if (expected !== found) return { error: 'checkDigit', expected, found };
  }

  // El PLU y el valor tienen que caer dentro del código (sin pisar el dígito de control, si se usa).
  // Mismo criterio que el backend al guardar la configuración (utils/scaleConfig.js).
  const last = cfg.checkDigit ? 12 : 13;
  const fits = (start, length) => start >= 1 && length >= 1 && start + length - 1 <= last;
  if (!fits(Number(cfg.pluStart), Number(cfg.pluLength)) || !fits(Number(cfg.valueStart), Number(cfg.valueLength))) {
    return { error: 'positions' };
  }
  const plu = Number(slice(code, Number(cfg.pluStart), Number(cfg.pluLength)));
  const rawValue = Number(slice(code, Number(cfg.valueStart), Number(cfg.valueLength)));

  const value = rawValue / 10 ** Number(cfg.decimals);
  return { label: { code, plu, value, valueType: cfg.valueType } };
};

// La etiqueta leída, o null si no lo es (ver readScaleCode para saber por qué)
export const parseScaleCode = (rawCode, config) => readScaleCode(rawCode, config).label || null;

// Texto para mostrar cuando una etiqueta de balanza no se pudo leer
export const scaleCodeProblem = (result, cfg) => {
  switch (result?.error) {
    case 'checkDigit':
      return (
        `El código se leyó mal: el último número (dígito de control) es ${result.found} y debería ser ` +
        `${result.expected}. Volvé a escanear la etiqueta o escribí el número a mano.`
      );
    case 'format':
      return 'Una etiqueta de balanza tiene 13 números.';
    case 'prefix':
      return `Las etiquetas de balanza empiezan con ${resolveScaleConfig(cfg).prefix}.`;
    case 'positions':
      return 'Las posiciones del PLU o del valor no entran en el código: revisá la configuración.';
    case 'disabled':
      return 'La lectura de etiquetas de balanza está desactivada.';
    default:
      return '';
  }
};

// Cantidad e importe de la línea a partir de la etiqueta y del producto con ese PLU.
// - Etiqueta con peso: cantidad = peso.
// - Etiqueta con importe: cantidad = importe / precio del sistema, redondeada al gramo.
//   "priceMismatch" marca diferencias mayores a ese redondeo. Con etiquetas de importe casi nunca
//   se activa: la etiqueta no dice el peso, así que un precio distinto en la balanza no se detecta.
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
