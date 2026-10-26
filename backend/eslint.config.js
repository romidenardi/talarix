import js from '@eslint/js';
import globals from 'globals';

// Reglas recomendadas de ESLint: variables sin declarar, código que nunca se ejecuta, variables sin
// usar, etc. Por ejemplo, habría frenado el error de remitos del 24/10 (una variable usada fuera de su bloque).
export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },
];
