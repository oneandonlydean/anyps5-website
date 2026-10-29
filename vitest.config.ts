import { defineConfig } from "vitest/config";

// The Worker in worker/ has its own tests, run with its own Vitest and the Workers runtime: npm run test:worker.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
