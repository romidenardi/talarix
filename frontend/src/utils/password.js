import { weakPasswordReason } from './passwordStrength.js';

// Mismas reglas que el servidor (backend/src/utils/password.js): mínimo 8 caracteres, máximo
// 72 bytes (límite de bcrypt; con tildes o emojis, cada carácter puede ocupar más de un byte) y
// nada fácil de adivinar (utils/passwordStrength.js).
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

// Devuelve el mensaje de error, o null si la contraseña cumple.
// context: { email, name } de la persona, para no aceptar su nombre o su email como contraseña.
export const passwordProblem = (password, context = {}) => {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (new TextEncoder().encode(value).length > MAX_PASSWORD_BYTES) {
    return 'La contraseña es demasiado larga (máximo 72 caracteres, menos si usa tildes o emojis)';
  }
  return weakPasswordReason(value, context);
};

// Para react-hook-form: validate: validatePassword (o validateOptionalPassword si puede quedar vacía).
// react-hook-form pasa también los demás campos: si el formulario tiene name y email, se usan.
const contextOf = (formValues) => ({ email: formValues?.email, name: formValues?.name });
export const validatePassword = (value, formValues) => passwordProblem(value, contextOf(formValues)) || true;
export const validateOptionalPassword = (value, formValues) =>
  (!value ? true : passwordProblem(value, contextOf(formValues)) || true);
