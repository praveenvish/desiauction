/**
 * Which secret the sign-in code digests and the passkey challenge are keyed
 * with: their own when one is configured, the engine's when it is not.
 *
 * In its own module, and pure, so the choice can be tested without an
 * environment — and so the two callers cannot come to disagree about it.
 * See `AUTH_CODE_SECRET` in env.ts for why there are two.
 */
export function authCodeSecret(env: {
  AUTH_CODE_SECRET?: string | undefined;
  ENGINE_SECRET: string;
}): string {
  return env.AUTH_CODE_SECRET ?? env.ENGINE_SECRET;
}
