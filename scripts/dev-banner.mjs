// Printed by `pnpm dev` before turbo takes over: services, URLs, credentials.
console.log(`
DESIAUCTION LOCAL — starting web (:3000) · engine (:4000) · finops-runner

  web        http://localhost:3000          OTP inbox  http://localhost:3000/dev/inbox
  engine     http://localhost:4000/healthz  minio      http://localhost:9001 (desiauction/desiauction)

  Demo sign-ins (phone → code appears in the OTP inbox):
    Founder    9999000001   org:owner + settlement + finops controller
    Admin      9999000002   org:owner
    Organizer  9999000003   org:staff
    Bidder A/B/C  9999000004/5/6 · Viewer 9999000007
    Org /org/demo-club · playground /competitions/demo-premier-league

  First run? pnpm setup:local · Health: pnpm health · Reset demo: pnpm seed:demo
`);
