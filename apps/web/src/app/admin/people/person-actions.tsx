"use client";

import { Button, Dialog, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { useStepUp, type GatedResult } from "../../../components/admin/use-step-up";
import {
  cancelInviteAction,
  grantRoleAction,
  invitePersonAction,
  revokeRoleAction,
  signOutEverywhereAction,
  suspendAction,
  unsuspendAction,
  type PeopleActionResult,
} from "../../../server/platform-ops/people-actions";

/*
 * THE SUPERADMIN'S BUTTONS (AC-1.2). One shape for every act: press, say why,
 * confirm it's you if the session needs it, read what happened. The reason is
 * required because it is kept in the audit log and sent to the person — the
 * dialog says so where it asks. Nothing here decides anything: the server
 * checks the role, the reason and the step-up again on every press.
 */

export interface RoleOption {
  readonly set: string;
  readonly label: string;
  readonly what: string;
}

const REASON_HINT =
  "Kept in the audit log and sent to the person in their email. 10–500 characters.";

function useRunner() {
  const router = useRouter();
  const toast = useToast();
  const { run, dialog } = useStepUp();
  const [busy, start] = useTransition();
  /*
   * Inside a transition, as every admin desk does it (pass-queue-panel.tsx):
   * the action and the refresh that follows are one transition, so the page
   * shows the new state as soon as it is fetched. Called outside one, the
   * refresh queued behind the action and the page lagged by seconds.
   */
  const go = (act: () => Promise<PeopleActionResult>): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      start(async () => {
        let message = "";
        let result: GatedResult;
        try {
          result = await run(async (): Promise<GatedResult> => {
            const answer = await act();
            if (answer.ok) {
              message = answer.message;
              return { ok: true };
            }
            return answer;
          });
        } catch {
          // A dropped connection: say so, and never leave the buttons busy.
          toast({
            title: "We couldn't reach DesiAuction. Reload the page to see what changed.",
            tone: "danger",
          });
          resolve(false);
          return;
        }
        if (!result.ok) {
          toast({ title: result.error, tone: "danger" });
          resolve(false);
          return;
        }
        toast({ title: message, tone: "success" });
        router.refresh();
        resolve(true);
      });
    });
  return { go, busy, stepUpDialog: dialog };
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field
      label="Reason"
      name="reason"
      help={REASON_HINT}
      maxLength={500}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      data-testid="admin-reason"
    />
  );
}

type Pending =
  | { kind: "grant" }
  | { kind: "revoke"; set: string; label: string }
  | { kind: "suspend" }
  | { kind: "unsuspend" }
  | { kind: "signout" };

const TITLES: Record<Pending["kind"], string> = {
  grant: "Give a role",
  revoke: "Remove a role",
  suspend: "Suspend this account",
  unsuspend: "Lift the suspension",
  signout: "Sign out everywhere",
};

/** The person page's controls: roles, suspension, sign-out — superadmin only. */
export function PersonActions({
  personId,
  name,
  isSelf,
  suspended,
  held,
  options,
}: {
  personId: string;
  name: string;
  isSelf: boolean;
  suspended: boolean;
  /** The platform sets they hold now. */
  held: readonly string[];
  options: readonly RoleOption[];
}) {
  const { go, busy, stepUpDialog } = useRunner();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const giveable = options.filter((option) => !held.includes(option.set));
  const [set, setSet] = useState(giveable[0]?.set ?? "");

  const open = (next: Pending) => {
    setReason("");
    if (next.kind === "grant") {
      setSet(giveable[0]?.set ?? "");
    }
    setPending(next);
  };

  const confirm = async () => {
    if (pending === null) {
      return;
    }
    const done = await go(() => {
      switch (pending.kind) {
        case "grant":
          return grantRoleAction(personId, set, reason);
        case "revoke":
          return revokeRoleAction(personId, pending.set, reason);
        case "suspend":
          return suspendAction(personId, reason);
        case "unsuspend":
          return unsuspendAction(personId, reason);
        case "signout":
          return signOutEverywhereAction(personId, reason);
      }
    });
    if (done) {
      setPending(null);
    }
  };

  const explain: Record<Pending["kind"], ReactNode> = {
    grant: (
      <Select
        label="Role"
        name="set"
        value={set}
        onChange={(event) => {
          setSet(event.target.value);
        }}
        data-testid="admin-role-select"
      >
        {giveable.map((option) => (
          <option key={option.set} value={option.set}>
            {option.label} — {option.what}
          </option>
        ))}
      </Select>
    ),
    revoke: (
      <p>
        {name} loses <strong>{pending?.kind === "revoke" ? pending.label : ""}</strong> right away.
        Nothing else on their account changes.
      </p>
    ),
    suspend: (
      <p>
        {name} is signed out of every device now and can&apos;t sign in until the suspension is
        lifted. Their clubs, seasons and roles are kept exactly as they are.
      </p>
    ),
    unsuspend: <p>{name} can sign in again, with everything as they left it.</p>,
    signout: (
      <p>
        Every device {name} is signed in on is signed out now. They can sign in again straight away
        — use this when a phone is lost or an account may be in the wrong hands.
      </p>
    ),
  };

  return (
    <div className="admin-person-actions" data-testid="admin-person-actions">
      <div className="admin-pills">
        {giveable.length > 0 ? (
          <Button
            size="sm"
            onClick={() => {
              open({ kind: "grant" });
            }}
            data-testid="admin-give-role"
          >
            Give a role
          </Button>
        ) : null}
        {held
          .map((heldSet) => options.find((option) => option.set === heldSet))
          .filter((option): option is RoleOption => option !== undefined)
          .map((option) => (
            <Button
              key={option.set}
              size="sm"
              variant="secondary"
              onClick={() => {
                open({ kind: "revoke", set: option.set, label: option.label });
              }}
              data-testid={`admin-remove-${option.set}`}
            >
              Remove {option.label}
            </Button>
          ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            open({ kind: "signout" });
          }}
          data-testid="admin-sign-out-everywhere"
        >
          Sign out everywhere
        </Button>
        {isSelf ? null : suspended ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              open({ kind: "unsuspend" });
            }}
            data-testid="admin-unsuspend"
          >
            Lift suspension
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              open({ kind: "suspend" });
            }}
            data-testid="admin-suspend"
          >
            Suspend account
          </Button>
        )}
      </div>
      <Dialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
        }}
        title={pending === null ? "" : TITLES[pending.kind]}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPending(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirm()}
              loading={busy}
              disabled={reason.trim().length < 10 || (pending?.kind === "grant" && set === "")}
              data-testid="admin-confirm"
            >
              {pending === null ? "" : TITLES[pending.kind]}
            </Button>
          </>
        }
      >
        {pending === null ? null : explain[pending.kind]}
        <ReasonField value={reason} onChange={setReason} />
      </Dialog>
      {stepUpDialog}
    </div>
  );
}

/** "Invite person" on /admin/people — superadmin only. */
export function InvitePerson({ options }: { options: readonly RoleOption[] }) {
  const { go, busy, stepUpDialog } = useRunner();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [sets, setSets] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const reset = () => {
    setContact("");
    setName("");
    setSets([]);
    setReason("");
  };

  return (
    <div className="admin-invite">
      <Button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        data-testid="admin-invite-person"
      >
        Invite person
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Invite someone to a role"
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
            <Button
              loading={busy}
              disabled={
                contact.trim() === "" ||
                name.trim().length < 2 ||
                sets.length === 0 ||
                reason.trim().length < 10
              }
              onClick={() =>
                void go(() => invitePersonAction({ contact, name, sets, reason })).then((done) => {
                  if (done) {
                    setOpen(false);
                  }
                })
              }
              data-testid="admin-invite-confirm"
            >
              Invite
            </Button>
          </>
        }
      >
        <p>
          They get the roles the first time they sign in with this phone or email — nothing is
          created for them before that. Someone already on DesiAuction gets them straight away.
        </p>
        <Field
          label="Mobile number or email"
          name="contact"
          value={contact}
          onChange={(event) => {
            setContact(event.target.value);
          }}
          data-testid="admin-invite-contact"
        />
        <Field
          label="Their name"
          name="name"
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          data-testid="admin-invite-name"
        />
        <fieldset className="admin-role-choices">
          <legend>Roles</legend>
          {options.map((option) => (
            <label key={option.set} className="admin-role-choice">
              <input
                type="checkbox"
                checked={sets.includes(option.set)}
                onChange={(event) => {
                  setSets((current) =>
                    event.target.checked
                      ? [...current, option.set]
                      : current.filter((one) => one !== option.set),
                  );
                }}
                data-testid={`admin-invite-${option.set}`}
              />
              <span>
                <strong>{option.label}</strong> — {option.what}
              </span>
            </label>
          ))}
        </fieldset>
        <ReasonField value={reason} onChange={setReason} />
      </Dialog>
      {stepUpDialog}
    </div>
  );
}

/** "Cancel" on a waiting invitation (/admin/roles) — superadmin only. */
export function CancelInvite({ inviteId, name }: { inviteId: string; name: string }) {
  const { go, busy, stepUpDialog } = useRunner();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
        data-testid={`admin-cancel-invite-${inviteId}`}
      >
        Cancel
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Cancel this invitation?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep it
            </Button>
            <Button
              loading={busy}
              disabled={reason.trim().length < 10}
              onClick={() =>
                void go(() => cancelInviteAction(inviteId, reason)).then((done) => {
                  if (done) {
                    setOpen(false);
                  }
                })
              }
              data-testid="admin-cancel-invite-confirm"
            >
              Cancel invitation
            </Button>
          </>
        }
      >
        <p>{name} won&apos;t get these roles when they sign in. Nothing else changes.</p>
        <ReasonField value={reason} onChange={setReason} />
      </Dialog>
      {stepUpDialog}
    </>
  );
}
