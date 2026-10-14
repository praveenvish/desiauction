"use server";
import { revalidatePath } from "next/cache";
import { currentSession } from "../../../server/auth/actions";
import { answerGuestClaimOffer } from "../../../server/scoring/guest-claim-offers";

interface ClaimAnswerState {
  error?: string;
  answered?: "accepted" | "declined";
}

export async function answerClaim(
  noticeId: string,
  _previous: ClaimAnswerState,
  form: FormData,
): Promise<ClaimAnswerState> {
  const session = await currentSession();
  if (!session) return { error: "Sign in again to answer." };
  const accept = form.get("answer") === "accept";
  const result = await answerGuestClaimOffer(session.personId, noticeId, accept);
  if (!result.ok)
    return {
      error:
        result.reason === "already_in_season"
          ? "You are already registered in this season, so this guest entry cannot join it."
          : result.reason === "no_phone"
            ? "Add your mobile number to your account first — the offer was made to that number."
            : "This offer is no longer open.",
    };
  revalidatePath("/me");
  return { answered: result.accepted ? "accepted" : "declined" };
}
