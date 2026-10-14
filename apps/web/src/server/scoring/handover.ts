import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  auditLog,
  fixtureOfficials,
  fixtures,
  matches,
  newId,
  people,
  type Db,
} from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../env";
import { authorityKind } from "./authority";
import { representedTeams } from "./trust-ledger";

const secret = () => env.SCORING_HANDOVER_SECRET ?? "dev-scoring-handover-secret-local-only";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");
export function verifyHandoverToken(token: unknown, now = new Date()) {
  if (typeof token !== "string" || token.length > 300 || !/^[A-Za-z0-9_-]+$/.test(token))
    return null;
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  if (Buffer.from(decoded).toString("base64url") !== token) return null;
  const parts = /^([0-9A-HJKMNP-TV-Z]{26})\.([1-9]\d*)\.([1-9]\d*)\.([A-Za-z0-9_-]{43})$/.exec(
    decoded,
  );
  if (!parts) return null;
  const [, fixtureId, attemptText, expiryText, signature] = parts;
  if (!fixtureId || !attemptText || !expiryText || !signature) return null;
  const attempt = Number(attemptText),
    expiry = Number(expiryText);
  if (
    !Number.isSafeInteger(attempt) ||
    !Number.isSafeInteger(expiry) ||
    expiry <= now.getTime() ||
    expiry > now.getTime() + 600_000
  )
    return null;
  const expected = sign(`${fixtureId}.${attemptText}.${expiryText}`);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { fixtureId, attempt, expiry, tokenHash: hash(token) };
}
const failure = (error: string, message: string) => ({ ok: false as const, error, message });
async function tokenAudit(
  db: Db,
  orgId: string,
  fixtureId: string,
  action: string,
  tokenHash: string,
) {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, orgId),
        eq(auditLog.subject, fixtureId),
        eq(auditLog.action, action),
        sql`${auditLog.meta}->>'tokenHash' = ${tokenHash}`,
      ),
    )
    .limit(1);
  return row;
}
const issueInput = z.object({ deviceId: z.string().trim().min(1).max(200) });
export async function issueHandover(
  db: Db,
  fixtureId: string,
  actorId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = issueInput.safeParse(raw);
  if (!input.success) return failure("bad_payload", "Check the scoring device.");
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .for("update");
  if (!match) return failure("not_found", "Match not found.");
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (
    !fixture ||
    match.scorerPersonId !== actorId ||
    match.scorerDeviceId !== input.data.deviceId ||
    !(await authorityKind(db, actorId, fixture))
  )
    return failure("forbidden", "Only the current scorer can hand over this match.");
  const value = `${fixtureId}.${String(match.attempt)}.${String(now.getTime() + 600_000)}`;
  const token = Buffer.from(`${value}.${sign(value)}`).toString("base64url");
  const tokenHash = hash(token);
  if (!(await tokenAudit(db, match.orgId, fixtureId, "match.claim.handover_issued", tokenHash)))
    await db.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "match.claim.handover_issued",
      scopeType: "org",
      scopeId: match.orgId,
      subject: fixtureId,
      meta: {
        tokenHash,
        attempt: match.attempt,
        issuerPersonId: actorId,
        issuerDeviceId: match.scorerDeviceId,
        claimedAt: match.scorerClaimedAt?.toISOString() ?? null,
      },
      at: now,
    });
  return { ok: true as const, token };
}
const redeemInput = z.object({ token: z.string(), deviceId: z.string().trim().min(1).max(200) });
export async function redeemHandover(db: Db, actorId: string, raw: unknown, now = new Date()) {
  const input = redeemInput.safeParse(raw);
  const verified = input.success ? verifyHandoverToken(input.data.token, now) : null;
  if (!input.success || !verified)
    return failure("bad_token", "This handover link is invalid or expired.");
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, verified.fixtureId))
    .for("update");
  if (!match) return failure("not_found", "Match not found.");
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, match.fixtureId));
  const issued = await tokenAudit(
    db,
    match.orgId,
    match.fixtureId,
    "match.claim.handover_issued",
    verified.tokenHash,
  );
  const meta = issued?.meta;
  if (
    !fixture ||
    match.attempt !== verified.attempt ||
    !issued ||
    !meta ||
    typeof meta !== "object" ||
    !("issuerPersonId" in meta) ||
    !("issuerDeviceId" in meta) ||
    !("claimedAt" in meta) ||
    meta.issuerPersonId !== match.scorerPersonId ||
    meta.issuerDeviceId !== match.scorerDeviceId ||
    meta.claimedAt !== (match.scorerClaimedAt?.toISOString() ?? null) ||
    !match.scorerPersonId
  )
    return failure("bad_token", "The scoring claim has changed. Ask for a new handover.");
  const issuerAuthority = await authorityKind(db, match.scorerPersonId, fixture);
  if (
    !issuerAuthority ||
    (await tokenAudit(
      db,
      match.orgId,
      match.fixtureId,
      "match.claim.handover_redeemed",
      verified.tokenHash,
    ))
  )
    return failure("bad_token", "This handover is no longer available.");
  const [person] = await db
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, actorId));
  if (!person) return failure("forbidden", "Sign in to take this match.");
  let officialId: string | null = null;
  if (!(await authorityKind(db, actorId, fixture))) {
    officialId = newId();
    await db.insert(fixtureOfficials).values({
      id: officialId,
      fixtureId: match.fixtureId,
      orgId: match.orgId,
      competitionId: match.competitionId,
      role: "scorer",
      personId: actorId,
      displayName: person.name ?? "Scorer",
      createdBy: match.scorerPersonId,
      createdAt: now,
    });
  }
  const sameClaim =
    match.scorerPersonId === actorId && match.scorerDeviceId === input.data.deviceId;
  await db
    .update(matches)
    .set({
      scorerPersonId: actorId,
      scorerDeviceId: input.data.deviceId,
      scorerClaimedAt: sameClaim
        ? match.scorerClaimedAt
        : new Date(Math.max(now.getTime(), (match.scorerClaimedAt?.getTime() ?? 0) + 1)),
      updatedAt: now,
    })
    .where(eq(matches.fixtureId, match.fixtureId));
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "match.claim.handover_redeemed",
    scopeType: "org",
    scopeId: match.orgId,
    subject: match.fixtureId,
    meta: {
      tokenHash: verified.tokenHash,
      issuerPersonId: match.scorerPersonId,
      issuerDeviceId: match.scorerDeviceId,
      officialId,
      inheritedAuthority: issuerAuthority,
      representedTeamIds:
        issuerAuthority === "d" ? await representedTeams(db, fixture, match.scorerPersonId) : [],
    },
    at: now,
  });
  return {
    ok: true as const,
    fixtureId: match.fixtureId,
    holder: { name: person.name ?? "Scorer" },
    lastSeq: match.lastSeq,
  };
}
