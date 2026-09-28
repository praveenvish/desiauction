import { generateVapidKeys } from "@desiauction/messaging/web-push";

/**
 * `pnpm push:keys` — a fresh VAPID key pair for web push (email programme
 * PR18). Run ONCE per environment and keep the pair: every browser that turns
 * notifications on subscribes to THIS public key, so a new pair orphans them.
 */
const keys = generateVapidKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${keys.privateKey}`);
console.log("WEB_PUSH_SUBJECT=mailto:support@desiauction.in");
