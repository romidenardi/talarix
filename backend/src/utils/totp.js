import crypto from 'node:crypto';

// Códigos de un solo uso por tiempo (TOTP, RFC 6238), compatibles con Google Authenticator:
// SHA-1, 6 dígitos, cada 30 segundos. Implementado con node:crypto, sin dependencias.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (text) => {
  const clean = String(text)
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

// Clave nueva de 160 bits (lo recomendado para SHA-1), en base32
export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

const codeForStep = (secret, step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
};

// Devuelve el número de paso que coincidió (para no aceptar dos veces el mismo código), o null.
// Acepta el código del momento y el de 30 segundos antes o después, por diferencias de reloj.
// lastStep: el último paso ya usado; un código de ese paso o de uno anterior se rechaza.
export const verifyTotp = (secret, code, { lastStep = null, now = Date.now(), window = 1 } = {}) => {
  const clean = String(code || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = step + offset;
    if (lastStep !== null && lastStep !== undefined && candidate <= Number(lastStep)) continue;
    const expected = Buffer.from(codeForStep(secret, candidate));
    if (crypto.timingSafeEqual(expected, Buffer.from(clean))) return candidate;
  }
  return null;
};

export const otpauthUrl = ({ issuer, account, secret }) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}` +
  `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// ---- Códigos de recuperación: 10 códigos de un solo uso; se guardan solo sus hashes ----
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I, para no confundirlos
const normalizeRecovery = (code) =>
  String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const hashRecovery = (code) => crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');

export const generateRecoveryCodes = (count = 10) => {
  const codes = Array.from({ length: count }, () => {
    const chars = Array.from(crypto.randomBytes(8), (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
};

// Parece un código de recuperación (8 letras o números, con o sin guion) y no uno de la app (6 dígitos)
export const looksLikeRecoveryCode = (code) => normalizeRecovery(code).length === 8;

// Si el código está entre los guardados, devuelve la lista sin él (se usa una sola vez); si no, null
export const consumeRecoveryCode = (hashes, code) => {
  if (!Array.isArray(hashes) || !looksLikeRecoveryCode(code)) return null;
  const hash = hashRecovery(code);
  const index = hashes.indexOf(hash);
  if (index === -1) return null;
  return hashes.filter((_, i) => i !== index);
};
