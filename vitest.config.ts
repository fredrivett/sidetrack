import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the `@/*` → `src/*` alias from tsconfig so component tests can use
  // the same import paths as the app.
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "eslint-rules/**/*.test.mjs",
    ],
    // Default to node; component tests opt into jsdom via a per-file
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
  },
});
