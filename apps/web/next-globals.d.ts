// The stable half of what `next-env.d.ts` declares — committed, hand-written,
// and never rewritten by a build.
//
// Next regenerates `next-env.d.ts` on every `next dev` / `next build`, and the
// last line it writes is `/// <reference path="./{distDir}/types/routes.d.ts" />`
// derived from `distDir` (next/dist/lib/typescript/writeAppTypeDeclarations).
// This app has TWO dist dirs on purpose — `.next` for a developer's server and
// `.next-e2e` for the Playwright build (next.config.mjs, NEXT_DIST_DIR) — so a
// tracked `next-env.d.ts` flips content depending on which command ran last and
// is permanently dirty in `git status`. It is therefore untracked (.gitignore),
// and these two directives, which never vary, live here instead.
//
// The route types themselves are NOT lost: tsconfig `include` globs BOTH
// `.next/types/**/*.ts` and `.next-e2e/types/**/*.ts`, which is what actually
// puts `routes.d.ts` in the program — the triple-slash reference was redundant.

/// <reference types="next" />
/// <reference types="next/image-types/global" />
