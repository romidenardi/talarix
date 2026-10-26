import bcrypt from 'bcryptjs';
import { httpError } from './httpError.js';
import { weakPasswordReason } from './passwordStrength.js';

// Reglas de contraseña compartidas por la activación, el restablecimiento y la gestión de usuarios.
// bcrypt solo usa los primeros 72 BYTES: con tildes o emojis, 72 caracteres pueden ocupar más,
// y el resto se ignoraría sin aviso. Por eso el máximo se mide en bytes.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;
// Vueltas de bcrypt para usuarios (el superadmin también usa 12). Los hashes viejos, con 10, siguen
// funcionando: bcrypt guarda las vueltas dentro del hash. Cada contraseña nueva o cambiada usa 12.
export const BCRYPT_ROUNDS = 12;

// context: { email, name } de la persona, para rechazar contraseñas con su nombre o su email
export const checkPassword = (password, context = {}) => {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw httpError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    throw httpError('La contraseña es demasiado larga (máximo 72 caracteres, menos si usa tildes o emojis)');
  }
  const weak = weakPasswordReason(value, context);
  if (weak) throw httpError(weak);
};

// Hash de una contraseña que no existe. Cuando el email no está registrado, el ingreso compara igual
// contra este hash: así tarda lo mismo que con un email real y no se puede averiguar por el tiempo
// de respuesta qué emails tienen cuenta.
const DUMMY_HASH = bcrypt.hashSync('contraseña-que-no-existe', BCRYPT_ROUNDS);
export const compareWithDummy = (password) => bcrypt.compare(String(password ?? ''), DUMMY_HASH);
