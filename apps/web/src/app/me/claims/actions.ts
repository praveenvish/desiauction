"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentSession } from "../../../server/auth/actions";
import { answerGuestClaimOffer } from "../../../server/scoring/guest-claim-offers";

interface ClaimAnswerState {
  error?: string;
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
  // The answered card leaves the list on re-render, so the confirmation lives
  // on the page, not in the card.
  redirect(`/me/claims?answered=${result.accepted ? "accepted" : "declined"}`);
}
