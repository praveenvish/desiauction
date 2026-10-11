import { env } from "../../env";
import { registerReminderSuite } from "./toss-reminder-suite";
registerReminderSuite(env.DATABASE_URL, env.APP_DATABASE_URL);
