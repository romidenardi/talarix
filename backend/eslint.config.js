import js from '@eslint/js';
import globals from 'globals';

// Reglas recomendadas de ESLint: variables sin declarar o sin usar, código que nunca se ejecuta, etc.
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
