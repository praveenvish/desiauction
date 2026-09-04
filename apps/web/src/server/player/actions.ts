"use server";

import {
  JERSEY_NAME_MAX,
  isBattingStyle,
  isBowlingStyle,
  isGender,
  parseRole,
  validateDateOfBirth,
  validateJerseyNumber,
  validateProfileLocation,
} from "@desiauction/core";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { playerProfileFor, upsertPlayerProfile, type PlayerProfile } from "./profile";

// The cricket-profile form (PI-1): /account's "How you play" panel and,
// later, the register wizard's write-back. One action, one validator per
// field, one document write. The form-state shape matches the 14 existing
// useActionState call sites: { error, field } on refusal, { saved } on green.

export interface PlayerProfileFormState {
  error?: string;
  /** Which control the error belongs to, for focus + aria wiring. */
  field?: string;
  saved?: boolean;
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** "" (an untouched optional control) becomes null — the never-answered state. */
function orNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export async function updatePlayerProfileAction(
  _previous: PlayerProfileFormState,
  formData: FormData,
): Promise<PlayerProfileFormState> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/account");
  }

  const genderRaw = orNull(formString(formData, "gender"));
  if (genderRaw !== null && !isGender(genderRaw)) {
    return { error: "Pick one of the listed options.", field: "gender" };
  }
  const gender = genderRaw !== null && isGender(genderRaw) ? genderRaw : null;

  let genderSelfDescribed: string | null = null;
  if (gender === "self_described") {
    const words = orNull(formString(formData, "gender_self_described"));
    if (words !== null && words.length > 40) {
      return {
        error: "That's a bit long — 40 characters or fewer.",
        field: "gender_self_described",
      };
    }
    genderSelfDescribed = words;
  }

  const dateOfBirth = orNull(formString(formData, "date_of_birth"));
  const dobVerdict = validateDateOfBirth(dateOfBirth, new Date());
  if (!dobVerdict.ok) {
    return {
      error:
        dobVerdict.reason === "future"
          ? "That date hasn't happened yet."
          : dobVerdict.reason === "too_old"
            ? "Check the year — that's before 1900."
            : "Use the date picker, or yyyy-mm-dd.",
      field: "date_of_birth",
    };
  }

  let location: string | null = null;
  const locationRaw = formString(formData, "location");
  if (locationRaw.trim() !== "") {
    const verdict = validateProfileLocation(locationRaw);
    if (!verdict.ok) {
      return { error: "That's a bit long — 80 characters or fewer.", field: "location" };
    }
    location = verdict.location;
  }

  const roleRaw = orNull(formString(formData, "default_role"));
  const defaultRole = roleRaw === null ? null : parseRole(roleRaw);
  if (roleRaw !== null && defaultRole === null) {
    return { error: "Pick one of the four roles.", field: "default_role" };
  }

  const battingRaw = orNull(formString(formData, "default_batting_style"));
  if (battingRaw !== null && !isBattingStyle(battingRaw)) {
    return { error: "Pick a listed batting style.", field: "default_batting_style" };
  }
  const bowlingRaw = orNull(formString(formData, "default_bowling_style"));
  if (bowlingRaw !== null && !isBowlingStyle(bowlingRaw)) {
    return { error: "Pick a listed bowling style.", field: "default_bowling_style" };
  }

  const jerseyName = orNull(formString(formData, "preferred_jersey_name"));
  if (jerseyName !== null && jerseyName.length > JERSEY_NAME_MAX) {
    return {
      error: `That's a bit long — ${String(JERSEY_NAME_MAX)} characters or fewer.`,
      field: "preferred_jersey_name",
    };
  }

  let preferredJerseyNumber: string | null = null;
  const jerseyNumberRaw = orNull(formString(formData, "preferred_jersey_number"));
  if (jerseyNumberRaw !== null) {
    const verdict = validateJerseyNumber(jerseyNumberRaw);
    if (!verdict.ok) {
      return { error: "Jersey numbers are 1-3 digits.", field: "preferred_jersey_number" };
    }
    preferredJerseyNumber = verdict.number;
  }

  const next: PlayerProfile = {
    gender,
    genderSelfDescribed,
    dateOfBirth,
    location,
    defaultRole,
    defaultBattingStyle: battingRaw,
    defaultBowlingStyle: bowlingRaw,
    preferredJerseyName: jerseyName,
    preferredJerseyNumber,
  };
  await upsertPlayerProfile(session.personId, next);
  return { saved: true };
}

/** The signed-in person's own profile — for /account and the register wizard. */
export async function myPlayerProfile(): Promise<PlayerProfile | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  return playerProfileFor(session.personId);
}
