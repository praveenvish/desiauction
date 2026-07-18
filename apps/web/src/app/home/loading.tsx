import { LoadingState } from "@desiauction/ui";

// PX-2: route-level skeleton for the composed /home reads (PX-1 04 §8).
// RULE (PX-2 finding): loading boundaries are added PER SEGMENT, and never
// above token/redirect pages (/join, /owner-join, /login, register) — a
// Suspense boundary turns their server redirect() into a streamed post-200
// redirect, which breaks HTTP-level redirect semantics for consumers.
export default function HomeLoading() {
  return (
    <main aria-busy>
      <LoadingState variant="page" />
    </main>
  );
}
