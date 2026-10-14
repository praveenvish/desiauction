import { env } from "../../../env";
export const dynamic = "force-dynamic";
export function GET(): Response {
  if (!env.TWA_SHA256_FINGERPRINTS) return new Response(null, { status: 404 });
  return Response.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: env.TWA_PACKAGE_NAME,
        sha256_cert_fingerprints: env.TWA_SHA256_FINGERPRINTS,
      },
    },
  ]);
}
