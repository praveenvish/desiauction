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

const STORAGE_TIMEOUT_MS = 3000;
function withinTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Financial recovery storage did not answer."));
      }, STORAGE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Authenticated server scope only. The existing account epoch also purges
 * finance on logout. Recording money never depends on browser storage: when
 * the device store cannot be bound or read (blocked or private browsers, or no
 * answer in 3 s), unsent drafts are kept in this tab instead (`degraded`).
 * Corrupt stored data still blocks, as before.
 */
export async function openFinancialIntentStorage(
  scope: Pick<FinancialIntent, "actorId" | "orgId" | "caseId">,
  isCurrent: () => boolean = () => true,
) {
  let closed = false;
  let accountGuard: () => void = () => {};
  let degraded = false;
  try {
    accountGuard = scoringWorkGuard(await withinTimeout(bindScoringActor(scope.actorId)));
  } catch {
    degraded = true;
  }
  const assertCurrent = () => {
    if (closed || !isCurrent()) throw new Error("This financial workspace has closed.");
    accountGuard();
  };
  const key = `ls1:finance-intent:${encodeURIComponent(scope.orgId)}:${encodeURIComponent(scope.caseId)}`;
  let memory: unknown = undefined;
  if (!degraded) {
    try {
      await withinTimeout(scoringRead<unknown>(key));
    } catch {
      degraded = true;
    }
  }
  const boundary = createFinancialIntentBoundary(
    degraded
      ? {
          read: () => Promise.resolve(memory),
          update: (change) => {
            assertCurrent();
            memory = change(memory);
            return Promise.resolve();
          },
        }
      : {
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
  // A corrupt store still prevents the workspace becoming mutation-ready.
  await boundary.read();
  return {
    ...boundary,
    degraded,
    close: () => {
      closed = true;
    },
  };
}
