import { httpError } from './httpError.js';

// Reglas de contraseña compartidas por la activación, el restablecimiento y la gestión de usuarios.
// bcrypt solo usa los primeros 72 BYTES: con tildes o emojis, 72 caracteres pueden ocupar más,
// y el resto se ignoraría sin aviso. Por eso el máximo se mide en bytes.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;
// Vueltas de bcrypt para usuarios (el superadmin también usa 12). Los hashes viejos, con 10, siguen
// funcionando: bcrypt guarda las vueltas dentro del hash. Cada contraseña nueva o cambiada usa 12.
export const BCRYPT_ROUNDS = 12;

export const checkPassword = (password) => {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw httpError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    throw httpError('La contraseña es demasiado larga (máximo 72 caracteres, menos si usa tildes o emojis)');
  }
};
