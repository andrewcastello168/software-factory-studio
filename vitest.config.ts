import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/desktop/src/**/*.test.ts', 'packages/{contracts,generator}/src/**/*.test.ts'],
    environment: 'node',
    // The planner previews raw stylesheet bytes. Preserve those bytes in parity tests.
    css: { include: [/packages\/generator\/templates\/.*\.css/u] },
  },
});
