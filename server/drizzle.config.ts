import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",       // D1 uses SQLite under the hood
  driver: "d1-http",
} satisfies Config;