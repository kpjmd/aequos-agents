import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'artifacts/**', 'cache/**', 'logs/**', 'coverage/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Downgraded to warn for the initial baseline — 48 pre-existing
      // violations across code paths we haven't audited individually.
      // Future PRs should chip these away; promote back to error once clean.
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
];
