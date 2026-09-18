# prototypes/ — frozen reference, not dead code

`va1/` is the VA-1 experience prototype that Phase 0B was run against: the
stage, owner-room and cockpit screens, frozen as release candidate `va1-rc1`
(git tag) with SHA-256 checksums for all twelve files in
[`va1/RC1_MANIFEST.md`](va1/RC1_MANIFEST.md).

It stays in the tree on purpose:

- **It is the evidence.** `docs/phase-0b/` (the review board, the expert
  review, the field kit, mission control, the executive waiver) cites these
  exact files and links to them by relative path; the manifest's checksums
  are how that evidence proves it describes what it says it describes.
- **The architecture says so.** `docs/phase-2/IP-0_DESIGN.md` fixes
  `prototypes/` as the frozen `va1-rc1` reference beside `apps/` and
  `packages/`, and `IP-1_DESIGN.md` states the rule: looked at, never
  imported.
- **It costs nothing at runtime.** Nothing imports it and it is outside the
  pnpm workspace, every lint and typecheck target, the dependency-cruiser
  graph, the build and the deployed image. Prettier ignores it
  (`.prettierignore`) so a formatting pass cannot silently break the checksums.

Do not edit anything under `va1/`: a changed byte fails the RC1 integrity
check the Phase 0B records depend on. Deleting it would break those records'
links while the tag kept the content anyway, which buys nothing.

(Final readiness audit 2026-09-18, FR-21: reviewed and kept, for the reasons
above.)
