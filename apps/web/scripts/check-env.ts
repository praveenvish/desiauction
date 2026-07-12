// Validates the environment without starting the app (IP-0_DESIGN §10).
import { parseEnv } from "../src/env.js";

const env = parseEnv(process.env);
console.log(`web env ok (NODE_ENV=${env.NODE_ENV})`);
