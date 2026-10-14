import { clearInboxWatermarks } from "./inbox-events";
import { clearScoringStorage } from "../app/score/storage";
export async function clearClientScoringSession(): Promise<void> {
  clearInboxWatermarks();
  await clearScoringStorage();
}

export async function scoringCleanupAndLogout(logout: () => Promise<void>): Promise<void> {
  await clearClientScoringSession();
  await logout();
}
