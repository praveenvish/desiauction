import { expect, it } from "vitest";
import { newId } from "@desiauction/db";
import { confirmationToken, readConfirmationToken } from "./confirmation-token";
const now = new Date("2026-10-10T00:00:00Z");
it("binds purpose, fixture, attempt, revision and opposing team with seven-day expiry", () => {
  const address = { fixtureId: newId(), teamId: newId(), attempt: 2, lastSeq: 40 };
  const token = confirmationToken(address, now);
  expect(readConfirmationToken(token, now)).toMatchObject(address);
  expect(readConfirmationToken(token, new Date(now.getTime() + 7 * 86400000 - 1))).not.toBeNull();
  expect(readConfirmationToken(token, new Date(now.getTime() + 7 * 86400000))).toBeNull();
  expect(readConfirmationToken(token, new Date(now.getTime() - 1))).toBeNull();
});
it("refuses altered claims, wrong purpose, noncanonical encoding and malformed input", () => {
  const token = confirmationToken(
    { fixtureId: newId(), teamId: newId(), attempt: 1, lastSeq: 20 },
    now,
  );
  const body = Buffer.from(token, "base64url").toString("utf8");
  for (const changed of [
    body.replace("confirm.1.", "handover.1."),
    body.replace(".1.20.", ".2.21."),
    body.slice(0, -1) + (body.endsWith("a") ? "b" : "a"),
  ])
    expect(readConfirmationToken(Buffer.from(changed).toString("base64url"), now)).toBeNull();
  for (const raw of [null, "", "!", token + "=", "x".repeat(401)])
    expect(readConfirmationToken(raw, now)).toBeNull();
});
