"use client";

import { Button, Dialog, Field, IconPlus, ToastProvider, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createTeamAction } from "../../../../server/competition/actions";

/** Distinguishable on a projector, and legible under the board's dark theme. */
const TEAM_PALETTE = [
  "#1f6f43",
  "#1d4e89",
  "#8e2420",
  "#6b3fa0",
  "#a8620f",
  "#0f6d75",
  "#8a1c53",
  "#4a5a2b",
];

/**
 * DA-20/DA-37: the next shade nobody has taken, and — once all eight are taken —
 * the least-used one rather than always the first.
 *
 * DA-20 moved this bug one shade over instead of removing it: the colour was
 * computed in a `useState` INITIALISER, so it was fixed at mount and never
 * re-rolled as teams were added. Twelve teams created through this dialog took
 * the same shade. It is now recomputed every time the dialog opens.
 */
function nextTeamColor(taken: readonly (string | null)[]): string {
  const used = new Map<string, number>(TEAM_PALETTE.map((shade) => [shade, 0]));
  for (const color of taken) {
    const shade = color?.toLowerCase() ?? "";
    if (used.has(shade)) {
      used.set(shade, (used.get(shade) ?? 0) + 1);
    }
  }
  let best = TEAM_PALETTE[0] ?? "#1f6f43";
  let bestCount = Number.POSITIVE_INFINITY;
  for (const shade of TEAM_PALETTE) {
    const count = used.get(shade) ?? 0;
    if (count < bestCount) {
      best = shade;
      bestCount = count;
    }
  }
  return best;
}

/**
 * "+ Add team" — the Teams page's one primary action, rendered by the
 * `@action` slot so it is in the server's HTML beside the page's title rather
 * than inserted after hydration. It owns its dialog: there is exactly one
 * "Team name" field on the page, whatever the grid below is showing.
 *
 * Its own ToastProvider because the slot sits in the shell, outside the page's.
 */
export function AddTeam(props: {
  slug: string;
  taken: readonly (string | null)[];
  locked: boolean;
}) {
  return (
    <ToastProvider>
      <AddTeamControl {...props} />
    </ToastProvider>
  );
}

function AddTeamControl({
  slug,
  taken,
  locked,
}: {
  slug: string;
  taken: readonly (string | null)[];
  locked: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [color, setColor] = useState(() => nextTeamColor(taken));
  const [formError, setFormError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const openAdd = () => {
    setFormError(null);
    setColor(nextTeamColor(taken));
    setOpen(true);
  };

  const addTeam = () => {
    setFormError(null);
    startTransition(async () => {
      const result = await createTeamAction(slug, name, shortName, color);
      if (!result.ok) {
        setFormError(result.error ?? "That team couldn't be created.");
        // DA-38: a failed submit used to leave focus on <body>, so a keyboard or
        // screen-reader user landed nowhere and never heard the error.
        nameRef.current?.focus();
        return;
      }
      toast({ tone: "success", title: "Team created" });
      setName("");
      setShortName("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="primary"
        data-testid="open-add-team"
        onClick={openAdd}
        disabled={locked}
        {...(locked ? { title: "The team list is locked — the auction has started." } : {})}
      >
        <IconPlus size={18} className="icon-lead" aria-hidden />
        Add team
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Add a team"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={addTeam} loading={pending} data-testid="add-team-workspace">
              Create team
            </Button>
          </>
        }
      >
        <div className="teams-dialog-form">
          <Field
            ref={nameRef}
            label="Team name"
            name="team-name"
            placeholder="Malad Mavericks"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            {...(formError !== null ? { error: formError } : {})}
          />
          <div className="teams-dialog-row">
            <Field
              label="Short name"
              name="team-short"
              placeholder="MAV"
              value={shortName}
              onChange={(event) => {
                setShortName(event.target.value);
              }}
            />
            <Field
              label="Colour"
              name="team-color"
              type="color"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
              }}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
