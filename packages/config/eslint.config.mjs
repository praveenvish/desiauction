import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// IP-0_DESIGN §8 (boundaries), §14 (no any), §23 (zero errors), §27 (no console).
// dependency-cruiser is the CI gate for boundaries; these rules are editor feedback.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/drizzle/meta/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "process.env is read only inside env.ts (IP-0_DESIGN §11).",
        },
      ],
    },
  },
  {
    // env.ts is the sanctioned process.env boundary (§11). instrumentation.ts
    // may read only NEXT_RUNTIME, which must be checked before env.ts is
    // importable (RC-A2, the documented Next/Sentry guard pattern).
    //
    // *.posture.test.ts joins them for a different reason (PA-1R Phase 0.5).
    // Those suites exist to run the application as `desiauction_app` and
    // `desiauction_system` while seeding as the owner, so they must address
    // THREE database roles at once. `env.ts` models the ONE connection the
    // application has, by design — a posture harness is not application config
    // and cannot be expressed through it. The exception is deliberately narrow:
    // this suffix and no other test file.
    files: ["**/env.ts", "**/instrumentation.ts", "**/*.posture.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  /*
   * THE TWO RULE SETS TYPESCRIPT CANNOT REPLACE.
   *
   * 800 React files, and neither of these had ever run. `tsc` is the only gate
   * this repository had over them, and it is blind to both:
   *
   *   RULES OF HOOKS is a RUNTIME contract, not a type. A `useState` behind an
   *   `if`, or a hook called inside a callback, type-checks perfectly and then
   *   desynchronises React's hook list the first time the branch flips — which
   *   on the live-auction surfaces means a crash mid-lot, in front of a room.
   *   `exhaustive-deps` is the same class: a stale closure over `endsAtMs` is a
   *   countdown that quietly stops, and no compiler can see it.
   *
   *   JSX-A11Y is asserted nowhere else either. The e2e suite runs axe, which
   *   is the right instrument and a LATE one: it only sees the pages a spec
   *   visits, in the states that spec drives. A missing label on a control
   *   behind a dialog nobody opened is invisible to it and obvious here.
   *
   * Scoped to the files that actually render, so nothing in core, db, the
   * engine or the runner pays for rules that cannot apply to them.
   *
   * NAMED RULES, NOT `reactHooks.configs.recommended`. That preset changed
   * shape in v7: it now carries the React Compiler's own analyses
   * (`immutability`, `refs`, `set-state-in-effect`, `purity`…), which are a
   * different and far more opinionated proposition than the two contracts
   * above — they flag working, deliberate code, including this repo's own
   * ref-based 10Hz auction clock, which exists precisely to avoid re-rendering
   * a room. Adopting them is a project with a design conversation in it, not a
   * gate to switch on during an audit; it is recorded as a follow-up. These two
   * are the ones whose violations are bugs by definition.
   */
  {
    files: ["**/*.tsx", "**/*.jsx"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      ...jsxA11y.flatConfigs.recommended.rules,

      /*
       * THREE OF JSX-A11Y'S RULES DISAGREE WITH THIS PRODUCT, AND ARE WRONG.
       *
       * Each was checked against the actual markup before being turned down;
       * none is off because it was noisy.
       *
       * `no-noninteractive-tabindex` forbids exactly what axe REQUIRES. Every
       * wide table here sits in a `<div className="table-scroll" tabIndex={0}
       * role="region" aria-label="…">` so a keyboard user can scroll it —
       * axe's `scrollable-region-focusable`, asserted on real pages by the e2e
       * suite. The lint rule cannot see that the div scrolls, so it reads a
       * deliberate affordance as a mistake, in fourteen places, all correct.
       * Axe is the authority on this one and it runs against rendered pages.
       *
       * `aria-role` treats any JSX attribute called `role` as an ARIA role,
       * including `<PlayerCard role="batter" />` — where `role` is the sport
       * pack's playing role and the component renders it as text. `ignoreNonDOM`
       * confines the rule to real elements, which is the only place an ARIA
       * role can exist.
       *
       * `label-has-associated-control` counts two levels down. Every switch in
       * this product puts its text in `<label htmlFor><input/><span><span>text`
       * — label, control and text all present and correctly associated, three
       * levels deep. Raising the depth checks the same property against the
       * markup that exists.
       */
      "jsx-a11y/no-noninteractive-tabindex": "off",
      "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
      "jsx-a11y/label-has-associated-control": ["error", { depth: 4 }],

      /*
       * AUTOFOCUS IS A JUDGEMENT, AND IT IS MADE IN THREE PLACES ON PURPOSE.
       *
       * The rule exists because autofocus on a page full of content moves a
       * screen-reader user away from the start of the document without asking.
       * The three uses here are the opposite case: a one-field step whose only
       * purpose is that field — the six-digit code after "we sent you a code",
       * the name on the onboarding gate, the role on the registration step.
       * Focusing anything else would make a person tab to the only thing the
       * screen is for. Turned down here, once, with the reason, rather than
       * scattered as three suppressions that each look like an exception.
       */
      "jsx-a11y/no-autofocus": "off",
    },
  },
  /*
   * THE FRAMEWORK'S OWN RULES, WHICH THE BUILD ASKS FOR BY NAME.
   *
   * `next build` prints "The Next.js plugin was not detected in your ESLint
   * configuration" on every run, and it was right: none of these had ever
   * executed. They catch the framework mistakes nothing else can see — a raw
   * `<img>` where `next/image` belongs (unsized, unoptimised, a layout shift on
   * every card), a synchronous `<script>` in the head, an `<a>` to an internal
   * route that throws away client navigation, a stylesheet linked outside the
   * document. Scoped to the web app, which is the only Next project here.
   */
  {
    // No brace glob: this repo pins `brace-expansion` for a CVE, and the pinned
    // major is incompatible with the minimatch@3 that @eslint/config-array still
    // reaches for — a `{ts,tsx}` here crashes ESLint with "expand is not a
    // function" before a single file is read.
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    plugins: { "@next/next": next },
    rules: {
      // `core-web-vitals` already contains `recommended`; spreading both made
      // every violation report twice.
      ...next.configs["core-web-vitals"].rules,

      /*
       * `next/image` CANNOT SERVE THESE, AND THE RULE HAS NO WAY TO KNOW.
       *
       * Every `<img>` left in this app is a crest or a player photo whose src
       * is a SIGNED, EXPIRING URL minted at read time by the media storage
       * port. `next/image` needs `images.remotePatterns` in next.config, which
       * would mean listing the bucket host and then letting the optimizer cache
       * a URL that is deliberately short-lived — an optimizer cache keyed on a
       * signature is a cache that misses every time and a bucket host in the
       * config is a URL anyone can then ask the optimizer to fetch for them.
       *
       * The poster routes are a harder no: they render inside `next/og`
       * (Satori), which draws a subset of HTML to a raster and has no React
       * component model to give `next/image` a place to exist.
       *
       * The property the rule is actually protecting — no layout shift — is
       * held directly instead: each of these carries explicit `width`/`height`,
       * and the e2e suite asserts it ("photos carry explicit dimensions — zero
       * layout shift by construction").
       */
      "@next/next/no-img-element": "off",
    },
  },
  {
    // packages/core purity: no ambient clock, no IO, no environment (§8).
    files: ["packages/core/src/**"],
    rules: {
      "no-restricted-globals": ["error", "process", "fetch"],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "core receives time via an injected Clock (IP-0_DESIGN §8).",
        },
      ],
    },
  },
  {
    // Loggers, repo scripts and throwaway spikes may write to stdout.
    files: ["**/logger.ts", "scripts/**", "spikes/**"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Config files at package roots are not part of a TS project.
    files: ["**/*.mjs", "**/*.cjs", "**/*.config.ts", "**/drizzle.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
