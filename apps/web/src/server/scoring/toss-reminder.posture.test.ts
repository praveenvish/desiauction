import { env } from "../../env";
import { registerReminderSuite } from "./toss-reminder-suite";
// Seed through owner; all behavior uses the production app role.
registerReminderSuite(process.env["OWNER_DATABASE_URL"] ?? env.DATABASE_URL, env.DATABASE_URL);
