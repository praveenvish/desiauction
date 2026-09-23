"use client";

import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconAlert,
  Notice,
  Pill,
  Select,
  useToast,
  type KitTone,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  addSuppression,
  findSuppressions,
  liftSuppressionAction,
  revertSuppression,
  type SuppressionActionResult,
} from "../../../../server/admin/suppression-actions";
import type {
  SuppressionRowView,
  SuppressionSearch,
  SuppressionSource,
} from "../../../../server/admin/suppression-views";
import { absoluteIst } from "../../admin-ui";

/**
 * The interactive half of /admin/notifications/suppressions: look a contact
 * up, lift one of its rows, add one by hand, revert a change. Every write
 * refreshes the page so the change list is the server's answer; the search
 * re-runs so the rows are too.
 *
 * The contact lives in this component's state and in the action's argument,
 * never in the URL (see suppression-actions.ts).
 */

const REASON_MIN = 5;
const REASON_MAX = 500;

const SOURCE: Record<SuppressionSource, string> = {
  inbound_text: "They texted STOP",
  email_provider: "Email provider report",
  admin: "Added by an admin",
  system: "Recorded by the platform",
};

const REASON_TONE: Record<string, KitTone> = {
  stop: "amber",
  complaint: "red",
  bounce: "red",
  manual: "purple",
  unreachable: "neutral",
};

function channelName(channel: "sms" | "email"): string {
  return channel === "sms" ? "Texts (SMS and WhatsApp)" : "Email";
}

function scopeName(scope: string): string {
  return scope === "global" ? "Everything" : scope;
}

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (
    act: () => Promise<SuppressionActionResult>,
    onDone?: () => void,
    onFail?: (result: Extract<SuppressionActionResult, { ok: false }>) => void,
  ) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
        onFail?.(result);
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.message, tone: "success" });
      onDone?.();
      router.refresh();
    });
  };
  return { pending, run };
}

function LiftDialog({
  row,
  contact,
  open,
  onClose,
  onLifted,
}: {
  row: SuppressionRowView;
  contact: string;
  open: boolean;
  onClose: () => void;
  onLifted: () => void;
}) {
  const { pending, run } = useRun();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const length = reason.trim().length;
  const valid =
    length >= REASON_MIN && length <= REASON_MAX && (!row.needsConfirmation || confirmed);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Lift this ${row.reason} for ${contact}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={row.needsConfirmation ? "danger" : "primary"}
            loading={pending}
            disabled={!valid}
            onClick={() => {
              run(
                () => liftSuppressionAction(row.id, reason, confirmed),
                () => {
                  onClose();
                  onLifted();
                },
              );
            }}
            data-testid="suppression-lift-confirm"
          >
            Lift it
          </Button>
        </>
      }
    >
      {row.needsConfirmation ? (
        <Notice tone="danger" icon={<IconAlert size={20} />} testId="suppression-lift-warning">
          {row.reason === "stop"
            ? "This person asked us not to contact them — they texted STOP. Lifting it means they will get messages again without having said START."
            : "This person complained — they told their email provider our mail was unwanted. Sending to them again risks the domain every other email goes out on."}{" "}
          Your reason is kept on the audit log against your name.
        </Notice>
      ) : (
        <p>
          {row.reason === "bounce"
            ? "The address bounced. Lift it once you know it works again — for example, the person fixed their mailbox."
            : "Messages to this contact on this channel will go again."}
        </p>
      )}
      <Field
        label="Reason"
        name={`suppression-lift-reason-${row.id}`}
        value={reason}
        required
        maxLength={REASON_MAX}
        autoComplete="off"
        data-testid="suppression-lift-reason"
        help={`Why it can go again. At least ${String(REASON_MIN)} characters.`}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {row.needsConfirmation ? (
        <label className="notify-switch ntc-toggle" htmlFor={`suppression-confirm-${row.id}`}>
          <input
            id={`suppression-confirm-${row.id}`}
            type="checkbox"
            checked={confirmed}
            data-testid="suppression-lift-understood"
            onChange={(event) => {
              setConfirmed(event.target.checked);
            }}
          />
          <span className="notify-switch-label">
            {row.reason === "stop"
              ? "I understand this person asked us to stop"
              : "I understand this person complained"}
          </span>
        </label>
      ) : null}
    </Dialog>
  );
}

function ResultRow({
  row,
  contact,
  onChanged,
}: {
  row: SuppressionRowView;
  contact: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = row.liftedAt === null;
  return (
    <li data-testid={`suppression-row-${row.id}`} data-active={active ? "true" : "false"}>
      <span className="admin-cell-main">
        <span className="ntc-kind-head">
          <span className="admin-name">
            {channelName(row.channel)} · {scopeName(row.scope)}
          </span>
          <span className="spr-pills">
            <Pill tone={REASON_TONE[row.reason] ?? "neutral"}>{row.reason}</Pill>
            <Pill tone={active ? "red" : "green"} dot testId={`suppression-state-${row.id}`}>
              {active ? "In force" : "Lifted"}
            </Pill>
          </span>
        </span>
        <span className="admin-meta">
          {SOURCE[row.source]} · since {absoluteIst(row.createdAt)}
          {row.liftedAt === null ? null : ` · lifted ${absoluteIst(row.liftedAt)}`}
        </span>
      </span>
      {active ? (
        <>
          <Button
            variant="secondary"
            size="touch"
            onClick={() => {
              setOpen(true);
            }}
            aria-label={`Lift ${row.reason} on ${channelName(row.channel)}, ${scopeName(row.scope)}`}
            data-testid={`suppression-lift-${row.id}`}
          >
            Lift…
          </Button>
          {open ? (
            <LiftDialog
              row={row}
              contact={contact}
              open={open}
              onClose={() => {
                setOpen(false);
              }}
              onLifted={onChanged}
            />
          ) : null}
        </>
      ) : null}
    </li>
  );
}

export function SuppressionSearchPanel() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SuppressionSearch | null>(null);
  const [searching, start] = useTransition();
  const search = (contact: string) => {
    start(async () => {
      setResult(await findSuppressions(contact));
    });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    search(query);
  };
  return (
    <div className="spr-body">
      <form
        className="spr-search"
        onSubmit={onSubmit}
        role="search"
        data-testid="suppression-search"
      >
        <Field
          label="Email address or mobile number"
          name="suppression-search"
          value={query}
          maxLength={320}
          autoComplete="off"
          inputMode="email"
          help="Exact match. A mobile number can be typed any way; it is looked up as +91…."
          data-testid="suppression-search-input"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <Button type="submit" size="touch" loading={searching} data-testid="suppression-search-go">
          Look up
        </Button>
      </form>
      <div aria-live="polite" data-testid="suppression-results">
        {result === null ? null : !result.ok ? (
          <Notice tone="warning" testId="suppression-search-error">
            {result.error}
          </Notice>
        ) : result.rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="Not suppressed"
            description={`Nothing stops ${channelName(result.channel).toLowerCase()} to ${result.contact}.`}
          />
        ) : (
          <>
            <p className="admin-meta">
              {channelName(result.channel)} to <span data-private>{result.contact}</span>
            </p>
            <ul className="admin-rows is-stacked">
              {result.rows.map((row) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  contact={result.contact}
                  onChanged={() => {
                    search(result.contact);
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export function AddSuppressionForm({ scopes }: { scopes: readonly string[] }) {
  const { pending, run } = useRun();
  const [contact, setContact] = useState("");
  const [scope, setScope] = useState("global");
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = contact.trim() !== "" && length >= REASON_MIN && length <= REASON_MAX;
  return (
    <form
      className="spr-body"
      data-testid="suppression-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        run(
          () => addSuppression(contact, scope, reason),
          () => {
            setContact("");
            setReason("");
            setScope("global");
          },
        );
      }}
    >
      <Field
        label="Email address or mobile number"
        name="suppression-add-contact"
        value={contact}
        required
        maxLength={320}
        autoComplete="off"
        help="An email address stops email; a mobile number stops texts, on SMS and WhatsApp."
        data-testid="suppression-add-contact"
        onChange={(event) => {
          setContact(event.target.value);
        }}
      />
      <Select
        label="What it stops"
        name="suppression-add-scope"
        value={scope}
        data-testid="suppression-add-scope"
        onChange={(event) => {
          setScope(event.target.value);
        }}
      >
        {scopes.map((value) => (
          <option key={value} value={value}>
            {value === "global" ? "Everything on that channel" : `Only ${value} messages`}
          </option>
        ))}
      </Select>
      <Field
        label="Reason"
        name="suppression-add-reason"
        value={reason}
        required
        maxLength={REASON_MAX}
        autoComplete="off"
        help={`Why, and who asked. At least ${String(REASON_MIN)} characters. Kept on the audit log.`}
        data-testid="suppression-add-reason"
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <div>
        <Button
          type="submit"
          size="touch"
          loading={pending}
          disabled={!valid}
          data-testid="suppression-add-go"
        >
          Suppress
        </Button>
      </div>
    </form>
  );
}

export function SuppressionRevertButton({
  auditId,
  summary,
}: {
  auditId: string;
  summary: string;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="touch"
      loading={pending}
      onClick={() => {
        run(() => revertSuppression(auditId));
      }}
      aria-label={`Revert: ${summary}`}
      data-testid={`suppression-revert-${auditId}`}
    >
      Revert
    </Button>
  );
}
