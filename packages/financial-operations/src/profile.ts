/**
 * The TaxProfile aggregate (IP-6_ARCHITECTURE §7/§8.1): one per org, one
 * stream, one reducer. Pure — no IO, no ambient time, no randomness.
 *
 * The profile is the org's DECLARED financial identity: the platform never
 * decides tax posture, it records what the organizer declared (ADR-6 — the
 * `obligationBasis` precedent: the platform never invents a debt, and never
 * invents a tax). The history is append-only; documents pin the profile seq
 * they were issued under, so an amendment never rewrites what an issued
 * document stood on.
 */

import { bool, str, type FinopsEventEnvelope, type FinopsReplayFailure } from "./events";

export type TaxPosture = "none" | "gst-registered";

export const TAX_POSTURES: readonly TaxPosture[] = ["none", "gst-registered"];

export function isTaxPosture(value: string): value is TaxPosture {
  return (TAX_POSTURES as readonly string[]).includes(value);
}

/** GSTIN syntax (15 chars: state code, PAN, entity, Z, checksum position). */
export function isGstinShaped(value: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(value);
}

export interface ProfileProjection {
  orgId: string;
  legalName: string;
  posture: TaxPosture;
  gstin: string | null;
  /** Issuance policy (foundation subset): auto-issue receipts on capture. */
  autoReceipt: boolean;
  declaredBy: string;
  /** How many declarations/amendments the profile has folded (its version). */
  version: number;
  recoveries: number;
  lastSeq: number;
  eventCount: number;
}

export type ProfileReplayResult = { ok: true; projection: ProfileProjection } | FinopsReplayFailure;

interface DeclarationFields {
  readonly legalName: string;
  readonly posture: TaxPosture;
  readonly gstin: string | null;
  readonly autoReceipt: boolean;
}

/** Shared by Declared (all fields required) and Amended (delta over current). */
function declarationOf(
  payload: Readonly<Record<string, unknown>>,
  current: DeclarationFields | null,
): DeclarationFields | null {
  const legalName = str(payload, "legalName") ?? current?.legalName ?? null;
  const postureRaw = str(payload, "posture") ?? current?.posture ?? null;
  const gstin = payload["gstin"] === undefined ? (current?.gstin ?? null) : str(payload, "gstin");
  const autoReceipt = bool(payload, "autoReceipt") ?? current?.autoReceipt ?? false;
  if (legalName === null || postureRaw === null || !isTaxPosture(postureRaw)) {
    return null;
  }
  // A registered posture requires a well-shaped GSTIN; `none` must carry none —
  // a stale GSTIN on a deregistered profile would misquote every later document.
  if (postureRaw === "gst-registered" && (gstin === null || !isGstinShaped(gstin))) {
    return null;
  }
  if (postureRaw === "none" && gstin !== null) {
    return null;
  }
  return { legalName, posture: postureRaw, gstin, autoReceipt };
}

/**
 * Fold the profile stream. Deterministic and fail-closed: a gap, an unknown
 * type, a declaration on an already-declared profile, an amendment without a
 * reason, or a malformed declaration stops the fold at the offending seq.
 */
export function replayProfile(events: readonly FinopsEventEnvelope[]): ProfileReplayResult {
  let projection: ProfileProjection | null = null;

  for (const event of events) {
    const fail = (reason: FinopsReplayFailure["reason"]): ProfileReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "ProfileDeclared") {
        return fail("unknown_profile");
      }
      const declared = declarationOf(event.payload, null);
      const orgId = str(event.payload, "orgId");
      if (declared === null || orgId === null || orgId !== event.streamId) {
        return fail("malformed_profile");
      }
      projection = {
        orgId,
        legalName: declared.legalName,
        posture: declared.posture,
        gstin: declared.gstin,
        autoReceipt: declared.autoReceipt,
        declaredBy: event.actor,
        version: 1,
        recoveries: 0,
        lastSeq: 1,
        eventCount: 1,
      };
      continue;
    }

    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }

    switch (event.type) {
      case "ProfileDeclared":
        return fail("illegal_replayed_transition");

      case "ProfileAmended": {
        if (str(event.payload, "reason") === null) {
          return fail("malformed_profile");
        }
        const amended = declarationOf(event.payload, projection);
        if (amended === null) {
          return fail("malformed_profile");
        }
        projection.legalName = amended.legalName;
        projection.posture = amended.posture;
        projection.gstin = amended.gstin;
        projection.autoReceipt = amended.autoReceipt;
        projection.version += 1;
        break;
      }

      case "ProfileRecovered": {
        projection.recoveries += 1;
        break;
      }

      default:
        return fail("unknown_event_type");
    }

    projection.lastSeq = event.seq;
    projection.eventCount += 1;
  }

  if (projection === null) {
    return { ok: false, atSeq: 0, reason: "unknown_profile" };
  }
  return { ok: true, projection };
}
