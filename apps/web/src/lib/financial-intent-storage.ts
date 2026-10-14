import {
  bindScoringActor,
  scoringRead,
  scoringUpdate,
  scoringWorkGuard,
} from "../app/score/storage";
import {
  createFinancialIntentBoundary,
  type FinancialIntent,
  type FinancialRecord,
} from "./financial-intent";

/** Authenticated server scope only. The existing account epoch also purges finance on logout. */
export async function openFinancialIntentStorage(
  scope: Pick<FinancialIntent, "actorId" | "orgId" | "caseId">,
  isCurrent: () => boolean = () => true,
) {
  const receipt = await bindScoringActor(scope.actorId);
  const accountGuard = scoringWorkGuard(receipt);
  let closed = false;
  const assertCurrent = () => {
    if (closed || !isCurrent()) throw new Error("This financial workspace has closed.");
    accountGuard();
  };
  const key = `ls1:finance-intent:${encodeURIComponent(scope.orgId)}:${encodeURIComponent(scope.caseId)}`;
  const boundary = createFinancialIntentBoundary(
    {
      read: () => scoringRead<unknown>(key),
      update: async (change) => {
        await scoringUpdate<readonly FinancialRecord[]>(key, (stored) => {
          assertCurrent();
          return change(stored);
        });
      },
    },
    scope,
    assertCurrent,
  );
  // An unavailable/corrupt store prevents the workspace becoming mutation-ready.
  await boundary.read();
  return {
    ...boundary,
    close: () => {
      closed = true;
    },
  };
}
