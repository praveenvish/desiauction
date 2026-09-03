import { ButtonLink, ErrorState } from "@desiauction/ui";

/**
 * Admin-scoped 404. The Demos tab is ALWAYS visible by design (the tab strip
 * must not leak which grants the viewer holds), so an administrator without
 * `platform:demo` lands here from a first-party tab — and the marketing 404's
 * "the link was mistyped" called a deliberate click a typo, inside an ops
 * console, under LOST BALL art. Same fail-closed posture, honest words: this
 * copy neither confirms nor denies what exists behind the gate, it names the
 * one mechanism (a separate grant) that governs every desk here.
 */
export default function AdminNotFound() {
  return (
    <main>
      <ErrorState
        headingLevel={1}
        title="Nothing to show here"
        description="This address doesn't resolve for your account — administration desks sit behind their own grants, and a page you can't read answers the same way as a page that doesn't exist."
        actions={
          <ButtonLink href="/admin" variant="secondary">
            Back to overview
          </ButtonLink>
        }
      />
    </main>
  );
}
