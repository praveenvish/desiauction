import { z } from "zod";
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4100),
    // F07: the internet-facing live service holds the least role there is —
    // EXECUTE on two P-1 functions, no table grants (ops/db/create-app-role.sql).
    LIVE_DATABASE_URL: z
      .string()
      .startsWith("postgres")
      .refine((value) => {
        try {
          return new URL(value).username === "desiauction_live";
        } catch {
          return false;
        }
      }, "Live must use desiauction_live"),
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
    /** Every socket on this process, across rooms (F05). */
    LIVE_MAX_SOCKETS: z.coerce.number().int().min(1).max(100_000).default(5000),
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
  const live = process.env.LIVE_DATABASE_URL;
  if (!owner || !live) throw new Error("Both isolated validation URLs required");
  const ownerTarget = new URL(owner),
    liveTarget = new URL(live);
  if (
    ownerTarget.host !== liveTarget.host ||
    ownerTarget.pathname !== liveTarget.pathname ||
    liveTarget.username !== "desiauction_live"
  )
    throw new Error("Explicit owner and live URLs must target the same test database");
  return { owner, live };
}
