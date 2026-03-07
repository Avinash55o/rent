import { defineConfig } from "drizzle-kit";

export default defineConfig({
    out: "./drizzle",           // migration output directory
    schema: "./src/db/schema.ts",
    dialect: "sqlite",          // D1 = SQLite
    driver: "d1-http",
});