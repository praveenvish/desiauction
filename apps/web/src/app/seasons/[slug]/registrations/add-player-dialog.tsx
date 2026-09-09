"use client";

import {
  BATTING_STYLES,
  BOWLING_STYLES,
  battingStyleLabel,
  bowlingStyleLabel,
} from "@desiauction/core";
import { Button, Dialog, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  addPlayerAction,
  competitionBandsAction,
  type AddPlayerActionResult,
} from "../../../../server/competition/actions";
import { PlayerPhotoUploader } from "./player-photo-uploader";

/**
 * The blank form. `role` is filled from the SEASON's first role, not from a
 * literal: it was `"batter"`, so a football season's dialog opened with a
 * cricket role selected — a value its own dropdown no longer offered, and one
 * the validator behind it refuses. An untouched form must submit something the
 * season can accept.
 */
const EMPTY_FORM = {
  name: "",
  phone: "",
  role: "",
  basePriceBand: "",
  dateOfBirth: "",
  battingStyle: "",
  bowlingStyle: "",
};

type FieldErrors = Extract<AddPlayerActionResult, { ok: false }>["fieldErrors"];

/**
 * Organizer adds one player by hand (parity §3.3) — the single-row sibling of
 * the CSV import, behind the same review gate and validation truth. Two steps
 * because a photo needs a registration id to attach to: details first, then an
 * optional photo for the row that now exists. The new player lands in
 * `submitted`; approving them stays a separate act on the dashboard.
 */
export function AddPlayerDialog({
  slug,
  roles,
}: {
  slug: string;
  /**
   * The season's own roles. Built from `REGISTRATION_ROLES` — cricket's four —
   * so the organizer adding a footballer by hand was offered Batter, Bowler,
   * All-rounder and Wicket-keeper, and the validator behind the dialog then
   * refused whichever of them they picked.
   */
  roles: readonly { key: string; label: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const blank = { ...EMPTY_FORM, role: roles[0]?.key ?? "" };
  const [form, setForm] = useState(blank);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(undefined);
  const [busy, setBusy] = useState(false);
  const [bands, setBands] = useState<readonly string[] | null>(null);
  const [created, setCreated] = useState<{ registrationId: string; number: string } | null>(null);

  const set = (key: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const openDialog = () => {
    setOpen(true);
    if (bands === null) {
      void competitionBandsAction(slug).then(setBands);
    }
  };

  const close = () => {
    setOpen(false);
    setCreated(null);
    setForm(blank);
    setFieldErrors(undefined);
  };

  const submit = async () => {
    setBusy(true);
    const result = await addPlayerAction(slug, form);
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      toast({ title: result.error, tone: "danger" });
      return;
    }
    setFieldErrors(undefined);
    toast({
      title: result.personExisted
        ? `Added existing member as ${result.number}`
        : `Player added · ${result.number}`,
      tone: "success",
    });
    setCreated({ registrationId: result.registrationId, number: result.number });
    router.refresh();
  };

  const addAnother = () => {
    setCreated(null);
    setForm(blank);
  };

  return (
    <>
      <Button size="sm" data-testid="open-add-player" onClick={openDialog}>
        + Add player
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={created === null ? "Add a player" : `Photo for ${form.name}`}
        footer={
          created === null ? (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} loading={busy} data-testid="add-player-submit">
                Add player
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={addAnother} data-testid="add-player-another">
                Add another
              </Button>
              <Button onClick={close} data-testid="add-player-done">
                Done
              </Button>
            </>
          )
        }
      >
        {created === null ? (
          <form
            className="add-player-form"
            data-testid="add-player-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field
              label="Full name"
              name="name"
              value={form.name}
              onChange={set("name")}
              required
              {...(fieldErrors?.name !== undefined ? { error: fieldErrors.name } : {})}
            />
            <Field
              label="Mobile number"
              name="phone"
              inputMode="tel"
              placeholder="98765 43210"
              value={form.phone}
              onChange={set("phone")}
              required
              {...(fieldErrors?.phone !== undefined ? { error: fieldErrors.phone } : {})}
            />
            <Select label="Playing role" name="role" value={form.role} onChange={set("role")}>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </Select>
            <Select
              label="Base price band (optional)"
              name="basePriceBand"
              value={form.basePriceBand}
              onChange={set("basePriceBand")}
              {...(fieldErrors?.basePriceBand !== undefined
                ? { error: fieldErrors.basePriceBand }
                : {})}
            >
              <option value="">Default band</option>
              {(bands ?? []).map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </Select>
            <Field
              label="Date of birth (optional)"
              name="dateOfBirth"
              type="date"
              value={form.dateOfBirth}
              onChange={set("dateOfBirth")}
            />
            <Select
              label="Batting style (optional)"
              name="battingStyle"
              value={form.battingStyle}
              onChange={set("battingStyle")}
            >
              <option value="">Not specified</option>
              {BATTING_STYLES.map((style) => (
                <option key={style} value={style}>
                  {battingStyleLabel(style)}
                </option>
              ))}
            </Select>
            <Select
              label="Bowling style (optional)"
              name="bowlingStyle"
              value={form.bowlingStyle}
              onChange={set("bowlingStyle")}
            >
              <option value="">Not specified</option>
              {BOWLING_STYLES.map((style) => (
                <option key={style} value={style}>
                  {bowlingStyleLabel(style)}
                </option>
              ))}
            </Select>
            {/* Submit on Enter without a visible duplicate of the footer button. */}
            <button type="submit" hidden aria-hidden />
          </form>
        ) : (
          <div className="add-player-photo" data-testid="add-player-photo">
            <p className="dash-hint">
              {form.name} is in as <strong data-testid="added-number">{created.number}</strong>{" "}
              (status: submitted). Add a photo now, or skip — it can always be added later from
              Details.
            </p>
            <PlayerPhotoUploader
              slug={slug}
              registrationId={created.registrationId}
              playerName={form.name}
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
