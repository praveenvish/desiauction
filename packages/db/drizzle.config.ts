import { defineConfig } from "drizzle-kit";

if (process.env.DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required for drizzle-kit (IP-0_DESIGN §11)");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL },
});
