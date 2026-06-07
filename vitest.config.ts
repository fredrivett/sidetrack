import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "eslint-rules/**/*.test.mjs"],
    environment: "node",
  },
});
