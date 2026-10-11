"use server";
import { currentSession } from "../auth/actions";
import { publicAccessProof } from "./public";
import { publicReminderIdentity } from "./public-page";
import { cancelTossReminder, requestTossReminder } from "./toss-reminder";
export async function tossReminderAction(input: {
  fixtureId: string;
  proof: unknown;
  channel: "push" | "email";
  consent: boolean;
  cancel?: boolean;
}) {
  const session = await currentSession();
  if (!session) return { ok: false as const, error: "Sign in to request a reminder." };
  const raw: unknown = input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false as const, error: "Check the reminder request." };
  const value = raw as Record<string, unknown>;
  const fixtureId = value["fixtureId"];
  const proof = publicAccessProof(value["proof"]);
  if (
    typeof fixtureId !== "string" ||
    !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(fixtureId) ||
    !proof ||
    !["push", "email"].includes(String(value["channel"]))
  )
    return { ok: false as const, error: "Check the reminder request." };
  const identity = await publicReminderIdentity(fixtureId, proof);
  if (!identity) return { ok: false as const, error: "Match not found." };
  if (value["cancel"] === true)
    return { ok: await cancelTossReminder(identity, session.personId), cancelled: true };
  const result = await requestTossReminder(
    identity,
    session.personId,
    proof,
    value["channel"] as "push" | "email",
    value["consent"] === true,
  );
  if (result.ok) return result;
  const messages = {
    not_found: "Match not found.",
    already_tossed: "The toss has already happened.",
    consent_required: "Choose how you want the reminder.",
    verified_email_required: "Verify your email on your account first.",
    device_required: "Turn notifications on for this browser first.",
    notifications_off: "Turn match notifications on in your account first.",
  };
  return { ok: false as const, error: messages[result.error] };
}
