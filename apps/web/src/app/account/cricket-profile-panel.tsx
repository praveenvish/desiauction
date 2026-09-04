"use client";

import {
  BATTING_STYLES,
  BOWLING_STYLES,
  GENDERS,
  PLAYER_ROLES,
  battingStyleLabel,
  bowlingStyleLabel,
  genderLabel,
  roleLabel,
} from "@desiauction/core";
import { Button, Card, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { track } from "../../lib/telemetry";
import { updatePlayerProfileAction } from "../../server/player/actions";
import type { PlayerProfile } from "../../server/player/profile";

/**
 * THE CRICKET PROFILE (PI-1): the person-level answers that follow you from
 * season to season. Everything optional — the card says so up front, because a
 * form of blank required-looking fields reads as homework.
 *
 * Gender and date of birth stay between the person and the platform: the copy
 * beside each says exactly who sees it, which is the DPDP notice done as UI
 * rather than as a policy link.
 */
export function CricketProfilePanel({ profile }: { profile: PlayerProfile }) {
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState(updatePlayerProfileAction, {});
  const [gender, setGender] = useState(profile.gender ?? "");
  const announced = useRef(false);

  useEffect(() => {
    if (state.saved === true && !announced.current) {
      announced.current = true;
      track("profile.updated");
      toast({ tone: "success", title: "Cricket profile saved" });
      router.refresh();
    }
    if (state.saved !== true) {
      announced.current = false;
    }
  }, [state.saved, router, toast]);

  const errorFor = (field: string) =>
    state.error !== undefined && state.field === field ? { error: state.error } : {};

  return (
    <Card className="account-card" data-testid="cricket-profile-panel">
      <h2>Cricket profile</h2>
      <p className="account-prose">
        How you play, remembered once — the next registration form starts filled in. Every field is
        optional.
      </p>
      <form action={formAction} className="cricket-profile-form">
        <div className="cricket-profile-grid">
          <Select
            label="Playing role"
            name="default_role"
            defaultValue={profile.defaultRole ?? ""}
            {...errorFor("default_role")}
          >
            <option value="">Choose…</option>
            {PLAYER_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </Select>
          <Field
            label="Date of birth"
            name="date_of_birth"
            type="date"
            defaultValue={profile.dateOfBirth ?? ""}
            help="Only organizers of seasons you join see your age."
            {...errorFor("date_of_birth")}
          />
          <Select
            label="Batting style"
            name="default_batting_style"
            defaultValue={profile.defaultBattingStyle ?? ""}
            {...errorFor("default_batting_style")}
          >
            <option value="">Choose…</option>
            {BATTING_STYLES.map((style) => (
              <option key={style} value={style}>
                {battingStyleLabel(style)}
              </option>
            ))}
          </Select>
          <Select
            label="Bowling style"
            name="default_bowling_style"
            defaultValue={profile.defaultBowlingStyle ?? ""}
            {...errorFor("default_bowling_style")}
          >
            <option value="">Choose…</option>
            {BOWLING_STYLES.map((style) => (
              <option key={style} value={style}>
                {bowlingStyleLabel(style)}
              </option>
            ))}
          </Select>
          <Field
            label="City"
            name="location"
            defaultValue={profile.location ?? ""}
            autoComplete="address-level2"
            help="Shown nowhere yet — it helps us route you to nearby seasons later."
            {...errorFor("location")}
          />
          <Select
            label="Gender"
            name="gender"
            value={gender}
            onChange={(event) => {
              setGender(event.target.value);
            }}
            help="Stays between you and the platform. Used only when a season declares an entry category."
            {...errorFor("gender")}
          >
            <option value="">Choose…</option>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {genderLabel(value)}
              </option>
            ))}
          </Select>
          {gender === "self_described" ? (
            <Field
              label="In your own words"
              name="gender_self_described"
              defaultValue={profile.genderSelfDescribed ?? ""}
              maxLength={40}
              {...errorFor("gender_self_described")}
            />
          ) : null}
          <Field
            label="Jersey name"
            name="preferred_jersey_name"
            defaultValue={profile.preferredJerseyName ?? ""}
            maxLength={30}
            help="What you'd like printed, when a season does kits."
            {...errorFor("preferred_jersey_name")}
          />
          <Field
            label="Jersey number"
            name="preferred_jersey_number"
            defaultValue={profile.preferredJerseyNumber ?? ""}
            inputMode="numeric"
            maxLength={3}
            {...errorFor("preferred_jersey_number")}
          />
        </div>
        <div className="profile-save">
          <Button type="submit" loading={pending} variant="secondary">
            Save cricket profile
          </Button>
        </div>
      </form>
    </Card>
  );
}
