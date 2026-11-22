import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// `pnpm eval`: the live model evals (*.eval.ts), kept out of `pnpm test`.
export default defineConfig({ ...base, test: { ...base.test, include: ["src/**/*.eval.ts"] } });
