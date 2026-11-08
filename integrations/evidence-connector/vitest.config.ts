import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['integrations/evidence-connector/*.test.ts'], testTimeout: 15000 } });
