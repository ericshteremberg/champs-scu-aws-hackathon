import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/investigation.test.ts', 'tests/investigation-*.test.ts','tests/aws-*.test.ts'], testTimeout: 15000 },
});
