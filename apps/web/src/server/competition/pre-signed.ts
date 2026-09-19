import { registrations } from "@desiauction/db";
import { sql } from "drizzle-orm";

/** `isPreSigned` (lib/pre-signed.ts) in SQL — any of the three marks. */
export const preSignedSql = sql<boolean>`(${registrations.isIcon} or ${registrations.isCaptain} or ${registrations.isRetained})`;
