// Validates the environment without starting the server (IP-0_DESIGN §10).
// Exits non-zero with the exact missing/invalid variables on failure.
import { parseEnv } from "../src/env.js";

const env = parseEnv(process.env);
console.log(`engine env ok (NODE_ENV=${env.NODE_ENV}, PORT=${String(env.PORT)})`);
