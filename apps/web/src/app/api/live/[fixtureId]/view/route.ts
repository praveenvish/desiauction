import { NextResponse } from "next/server";
import { env } from "../../../../../env";
import { clientIp } from "../../../../../lib/client-ip";
import { currentSession } from "../../../../../server/auth/actions";
import { publicAccessProof } from "../../../../../server/scoring/public";
import { recordPublicView } from "../../../../../server/scoring/viewer";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const proof = publicAccessProof(raw);
  const { fixtureId } = await context.params;
  const session = proof ? await currentSession().catch(() => null) : null;
  const viewer = {
    clientAddress: clientIp(request.headers, env.TRUSTED_PROXY_COUNT),
    personId: session?.personId ?? null,
  };
  if (!proof || !(await recordPublicView(fixtureId, proof, viewer)))
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
