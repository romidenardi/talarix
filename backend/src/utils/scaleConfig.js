import { httpError } from './httpError.js';

// Formato de fábrica de las balanzas Systel (EAN-13):
//   2 0 | 0 4 1 7 | 6 4 2 6 0 0 | 6
//   prefijo | PLU (4) | valor (6) | dígito de control
export const DEFAULT_SCALE_CONFIG = {
  enabled: false,
  prefix: '20',
  pluStart: 3,
  pluLength: 4,
  valueStart: 7,
  valueLength: 6,
  valueType: 'quantity', // 'quantity' = peso, 'amount' = importe total
  decimals: 3,
  checkDigit: true,
};

export const resolveScaleConfig = (stored) => ({
  ...DEFAULT_SCALE_CONFIG,
  ...(stored && typeof stored === 'object' ? stored : {}),
});

const asInt = (value, label, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw httpError(`${label} debe ser un número entero entre ${min} y ${max}`);
  }
  return n;
};

export const normalizeScaleConfig = (input) => {
  const source = resolveScaleConfig(input);

  const prefix = String(source.prefix ?? '').trim();
  if (!/^\d{0,4}$/.test(prefix)) throw httpError('El prefijo debe tener solo números (hasta 4)');

  const valueType = source.valueType;
  if (!['quantity', 'amount'].includes(valueType)) {
    throw httpError('El valor del código tiene que ser el peso o el importe');
  }

  const checkDigit = source.checkDigit !== false;
  const lastDataPosition = checkDigit ? 12 : 13;

  const pluStart = asInt(source.pluStart, 'La posición del PLU', 1, 13);
  const pluLength = asInt(source.pluLength, 'La longitud del PLU', 1, 6);
  const valueStart = asInt(source.valueStart, 'La posición del valor', 1, 13);
  const valueLength = asInt(source.valueLength, 'La longitud del valor', 1, 8);
  const decimals = asInt(source.decimals, 'Los decimales del valor', 0, 4);

  const pluEnd = pluStart + pluLength - 1;
  const valueEnd = valueStart + valueLength - 1;

  if (pluEnd > lastDataPosition || valueEnd > lastDataPosition) {
    throw httpError(
      checkDigit
        ? 'El PLU y el valor tienen que entrar en los primeros 12 dígitos (el 13 es el de control)'
        : 'El PLU y el valor tienen que entrar en los 13 dígitos del código',
    );
  }
  if (pluStart <= prefix.length || valueStart <= prefix.length) {
    throw httpError('El PLU y el valor no pueden pisar el prefijo');
  }
  if (pluStart <= valueEnd && valueStart <= pluEnd) {
    throw httpError('El PLU y el valor no pueden superponerse');
  }

  return {
    enabled: source.enabled === true,
    prefix,
    pluStart,
    pluLength,
    valueStart,
    valueLength,
    valueType,
    decimals,
    checkDigit,
  };
};
