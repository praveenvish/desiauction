## What / why (≤5 lines)

## Governing citations

<!-- Canon C-n / doc / RC-n / invariant IDs when touching governed behaviour; "none" otherwise -->

## Test evidence

<!-- what proves this works: test names, command output, screenshots -->

## Rollback note

<!-- required for anything touching deploy or migrations; "n/a" otherwise -->

## Review checklist (IP-0_DESIGN §19)

- [ ] boundary rules respected (dep-cruiser green)
- [ ] no new `any` / suppression
- [ ] errors handled per §28 (no silent catch)
- [ ] logs structured, no PII (§27)
- [ ] config via `env.ts` only
- [ ] migration reversible-in-dev / expand-contract note
- [ ] tests assert behaviour
- [ ] docs touched if behaviour moved
