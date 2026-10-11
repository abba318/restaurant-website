import { defineConfig, globalIgnores } from 'eslint/config';
import { fixupConfigRules } from '@eslint/compat';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...fixupConfigRules([...nextVitals, ...nextTypescript]),
  {
    rules: {
      '@next/next/no-img-element': 'off',
      // The storefront and checkout hydrate cart state from browser storage on mount.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
