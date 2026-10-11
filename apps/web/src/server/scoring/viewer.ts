import { flushPublicViewer, publicViewerIdentity, type PublicAccessProof } from "./public";
import { ViewerBuckets } from "./viewer-buckets";
const buckets = new ViewerBuckets(flushPublicViewer);
export async function recordPublicView(
  fixtureId: string,
  proof: PublicAccessProof,
): Promise<boolean> {
  const identity = await publicViewerIdentity(fixtureId, proof);
  if (!identity) return false;
  buckets.record(identity, proof, Date.now());
  return true;
}
