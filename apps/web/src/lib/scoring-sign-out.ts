import { loadScoringStorage } from "./scoring-storage-loader";
/** Finish local cleanup before invoking the existing session-revoking action. */
export function scoringSignOut(logout: () => Promise<void>): Promise<void> {
  return loadScoringStorage().then(({ scoringCleanupAndLogout }) =>
    scoringCleanupAndLogout(logout),
  );
}
