// Security headers from day one (IP-0_DESIGN §31); CSP arrives with real pages in IP-1/IP-3.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

/** @type {import("next").NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@desiauction/core", "@desiauction/contracts", "@desiauction/ui"],
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};
