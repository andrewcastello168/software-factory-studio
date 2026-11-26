import js from '@eslint/js';
import hooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const electronAndNode = {
  patterns: [
    { group: ['electron', 'electron/*', 'node:*', '**/main/**', '**/preload/**', '**/renderer/**'], message: 'Use only the dependencies of this process boundary.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/test-results/**', '**/playwright-report/**', '**/coverage/**', 'packages/generator/templates/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', setTimeout: 'readonly' } },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/contracts/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', electronAndNode] },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['apps/desktop/src/{main,preload}/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['**/renderer/**', 'react', 'react-dom', 'react-dom/*'],
      }],
    },
  },
  {
    files: ['apps/desktop/src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['**/renderer/**', '**/main/**', 'react', 'react-dom', 'react-dom/*', 'node:*'],
      }],
    },
  },
);
