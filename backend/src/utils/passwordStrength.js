// Contraseñas demasiado fáciles de adivinar. MISMO archivo en frontend/src/utils/passwordStrength.js
// (una prueba del backend controla que sean iguales).

// Las más usadas (en castellano y en inglés), ya en minúscula y sin tildes
export const COMMON_PASSWORDS = [
  '12345678', '123456789', '1234567890', '0123456789', '11111111', '00000000', '12341234', '87654321',
  '11223344', '12121212', '123123123', '147258369', '159753456', '1q2w3e4r', '1qaz2wsx', 'qwertyui',
  'qwerty12', 'qwerty123', 'asdfghjk', 'zxcvbnm1', 'password', 'password1', 'password123', 'passw0rd',
  'iloveyou', 'abc12345', 'abcd1234', 'abcdefgh', 'admin123', 'administrador', 'administrator',
  'welcome1', 'bienvenido', 'bienvenida', 'contrasena', 'contrasena1', 'contrasenia', 'clave123',
  'miclave1', 'teamo123', 'tequiero', 'argentina', 'argentina1', 'bocajuniors', 'riverplate',
  'river123', 'boca1234', 'messi123', 'futbol123', 'football', 'sunshine', 'princesa', 'superman',
  'batman123', 'mariposa', 'estrella', 'corazon1', 'chocolate', 'computadora', 'comercio', 'negocio1',
  'talarix', 'talarix1', 'talarix123',
];

const normalize = (value) =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const isSequence = (value) =>
  SEQUENCES.some((seq) => seq.includes(value) || seq.split('').reverse().join('').includes(value));

// Devuelve el motivo si es débil, o null. `context`: { email, name } de la persona, para no
// aceptar su propio nombre o email como contraseña.
export const weakPasswordReason = (password, context = {}) => {
  const value = normalize(password);
  if (!value) return null;
  const tip = 'Usá una frase o mezclá varias palabras con números.';

  if (COMMON_PASSWORDS.includes(value)) return `Esa contraseña es de las más usadas y se adivina enseguida. ${tip}`;
  if (/^(.)\1+$/.test(value)) return `La contraseña no puede ser el mismo carácter repetido. ${tip}`;
  if (isSequence(value)) return `La contraseña no puede ser una secuencia (como 12345678 o abcdefgh). ${tip}`;
  if (value.includes('talarix')) return `La contraseña no puede contener "talarix". ${tip}`;

  const emailUser = normalize(context.email).split('@')[0];
  if (emailUser.length >= 4 && value.includes(emailUser)) return `La contraseña no puede contener tu email. ${tip}`;
  const nameParts = normalize(context.name).split(/\s+/).filter((part) => part.length >= 4);
  if (nameParts.some((part) => value.includes(part))) return `La contraseña no puede contener tu nombre. ${tip}`;
  return null;
};
