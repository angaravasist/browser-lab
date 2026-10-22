import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', AbortSignal: 'readonly', crypto: 'readonly' } },
    rules: {
      // External payloads (WebDriver capabilities, Grid status, SQLite rows) are loosely typed by nature.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['tests/fixtures/site/**'], languageOptions: { globals: { document: 'readonly', location: 'readonly', URLSearchParams: 'readonly' } } },
);
