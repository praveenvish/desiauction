import { z } from "zod";
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4100),
    SYSTEM_DATABASE_URL: z
      .string()
      .startsWith("postgres")
      .refine((value) => {
        try {
          return new URL(value).username === "desiauction_system";
        } catch {
          return false;
        }
      }, "Live must use desiauction_system"),
    LIVE_ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).max(10).default(0),
    APP_VERSION: z.string().default("dev"),
  })
  .refine(
    (value) => value.NODE_ENV !== "production" || value.LIVE_ALLOWED_ORIGINS.length > 0,
    "LIVE_ALLOWED_ORIGINS required in production",
  );
export function parseEnv(raw: NodeJS.ProcessEnv) {
  return schema.parse(raw);
}
export type Env = z.infer<typeof schema>;

export function readEnv() {
  return parseEnv(process.env);
}
export function integrationUrls() {
  const owner = process.env.DATABASE_URL;
  const system = process.env.SYSTEM_DATABASE_URL;
  if (!owner || !system) throw new Error("Both isolated validation URLs required");
  const ownerTarget = new URL(owner),
    systemTarget = new URL(system);
  if (
    ownerTarget.host !== systemTarget.host ||
    ownerTarget.pathname !== systemTarget.pathname ||
    systemTarget.username !== "desiauction_system"
  )
    throw new Error("Explicit owner and system URLs must target the same test database");
  return { owner, system };
}
