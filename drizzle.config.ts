import type { Config } from "drizzle-kit";

export default {
  schema: "./src/core/schema.ts",
  out: "./src/core/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH ?? "./data/sidetrack.db",
  },
} satisfies Config;
