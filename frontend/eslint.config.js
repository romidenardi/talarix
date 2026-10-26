import js from '@eslint/js';
import globals from 'globals';

// Mismas reglas que el backend (recomendadas de ESLint), con JSX y las variables del navegador
export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },
  {
    // Las pruebas corren con Node
    files: ['test/**/*.js', 'vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
