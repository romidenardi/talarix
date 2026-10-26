// CUIT / CUIL / DNI. MISMO archivo en backend/src/utils/taxId.js (una prueba controla que coincidan).
//
// - 11 números: CUIT o CUIL. Se verifica el dígito verificador y se guarda como 20-12345678-3.
// - 7 u 8 números: DNI (por ejemplo, de un consumidor final). Se guarda solo con números.
// Acepta guiones, puntos y espacios al escribir.

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export const cuitCheckDigit = (first10) => {
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first10[i]), 0);
  const digit = 11 - (sum % 11);
  if (digit === 11) return 0;
  if (digit === 10) return null; // ese número no puede ser un CUIT válido
  return digit;
};

// Devuelve { value } con el número normalizado (o null si está vacío), o { error } con el motivo
export const normalizeTaxId = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null };
  if (!/^[\d\s.\-/]+$/.test(text)) return { error: 'El CUIT solo puede tener números (y guiones)' };

  const digits = text.replace(/\D/g, '');
  if (digits.length === 7 || digits.length === 8) return { value: digits };
  if (digits.length !== 11) return { error: 'El CUIT tiene que tener 11 números (o el DNI, 7 u 8)' };

  const check = cuitCheckDigit(digits.slice(0, 10));
  if (check === null || check !== Number(digits[10])) {
    return { error: 'El CUIT no es válido: revisá los números (el último es el dígito verificador)' };
  }
  return { value: `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits[10]}` };
};

// Para comparar: solo los números
export const taxIdDigits = (raw) => String(raw ?? '').replace(/\D/g, '');
