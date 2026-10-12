/** Explicit isolated database boundary for UI auction validation. */
for (const name of [
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "SYSTEM_DATABASE_URL",
  "RUNNER_DATABASE_URL",
]) {
  const target = new URL(process.env[name] ?? "");
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "15437" ||
    target.pathname !== "/ls1_c29_clean"
  )
    throw new Error(`Unsafe real-auction validation target: ${name}`);
}
export const auctionValidationEnv = {
  databaseUrl: process.env["DATABASE_URL"] ?? "",
  fixtureRegistry: process.env["UI_VALIDATION_FIXTURE_FILE"],
};
