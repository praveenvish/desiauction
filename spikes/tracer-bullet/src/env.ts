import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().startsWith("postgres"),
  PORT: z.coerce.number().int().positive().default(4100),
  TARGET_URL: z.string().default("http://127.0.0.1:4100"),
});

export const env = schema.parse(process.env);
