import { createHash } from "node:crypto";
import { env } from "../../env";
import {
  flushPublicViewer,
  isMatchInsider,
  publicViewerIdentity,
  type PublicAccessProof,
} from "./public";
import { ViewerBuckets } from "./viewer-buckets";
const buckets = new ViewerBuckets(flushPublicViewer);
const salt = () => env.SCORING_HANDOVER_SECRET ?? "dev-scoring-handover-secret-local-only";

/** A per-fixture salted key for one client; the address itself is never kept. */
export function viewerKey(fixtureId: string, clientAddress: string | null): string {
  return createHash("sha256")
    .update(`view.1:${salt()}:${fixtureId}:${clientAddress ?? "unknown"}`)
    .digest("base64url");
}

/**
 * Counts one public view. People who could gain from a higher viewer peak (the
 * scorer holding the match and either team's managers) are answered normally but
 * not counted, and a client counts once a minute however often it pings.
 */
export async function recordPublicView(
  fixtureId: string,
  proof: PublicAccessProof,
  viewer: { clientAddress: string | null; personId: string | null },
): Promise<boolean> {
  const identity = await publicViewerIdentity(fixtureId, proof);
  if (!identity) return false;
  if (viewer.personId !== null && (await isMatchInsider(fixtureId, viewer.personId))) return true;
  buckets.record(identity, proof, Date.now(), viewerKey(fixtureId, viewer.clientAddress));
  return true;
}
