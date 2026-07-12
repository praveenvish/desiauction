import type { HealthResponse } from "@desiauction/contracts";
import { NextResponse } from "next/server";

import { env } from "../../env";

// Web has no infrastructure checks yet; the checks map grows when it gains
// dependencies (IP-0_DESIGN §29).
export function GET(): NextResponse<HealthResponse> {
  return NextResponse.json({ status: "ok", version: env.APP_VERSION, checks: {} });
}
