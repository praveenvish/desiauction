"use server";
import { revalidatePath } from "next/cache";
import { currentSession } from "../auth/actions";
import { savePreviousCareer, deletePreviousCareer } from "./previous-career";
export interface PreviousCareerFormState {
  error?: string;
  saved?: boolean;
}
export async function updatePreviousCareerAction(
  _previous: PreviousCareerFormState,
  form: FormData,
): Promise<PreviousCareerFormState> {
  const session = await currentSession();
  if (!session) return { error: "Sign in to update your history." };
  if (form.get("intent") === "delete") {
    await deletePreviousCareer(session.personId);
  } else {
    const summary: Record<string, unknown> = {};
    for (const key of ["matches", "runs", "wickets", "fromYear", "toYear"] as const) {
      const value = form.get(`previousCareer_${key}`);
      if (typeof value !== "string") return { error: "Check your figures." };
      if (value.trim()) summary[key] = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
    }
    const source = form.get("source");
    if (typeof source === "string" && source.trim()) summary.source = source;
    if (!(await savePreviousCareer(session.personId, summary)))
      return {
        error: "Use whole positive figures and valid years, with the start before the end.",
      };
  }
  revalidatePath("/me");
  return { saved: true };
}
