"use client";

import { Button, Dialog, Field, IconAlert, Notice, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  clearProviderTemplate,
  mapProviderTemplate,
  refreshTemplateStatus,
  revertProviderTemplate,
  submitProviderTemplate,
  type TemplateActionResult,
} from "../../../../server/admin/provider-template-actions";

/**
 * The interactive pieces of /admin/notifications/templates. Everything else is
 * a server render of the projection; each island calls one action, says what
 * happened in a toast, and refreshes the page so every chip is the server's
 * answer. A button shows its own pending state from the click — the lesson of
 * Phase 1, where a control that sat still through save-and-refresh read as
 * dead.
 */

const NAME_MAX = 512;
const NAME_RULE = /^[a-z0-9_]+$/;
const ID_RULE = /^[A-Za-z0-9_-]+$/;
const NOTE_MAX = 500;
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
] as const;

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (act: () => Promise<TemplateActionResult>, onDone?: () => void) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
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

/** The same rule the writer applies, said before the round trip. */
function nameProblem(channel: "whatsapp" | "sms", value: string): string | undefined {
  const v = value.trim();
  if (v === "") return undefined;
  if (channel === "whatsapp") {
    if (v.length > NAME_MAX) return `At most ${String(NAME_MAX)} characters.`;
    if (!NAME_RULE.test(v)) return "Only lowercase letters, digits and underscores (a-z, 0-9, _).";
    return undefined;
  }
  if (v.length > 64) return "At most 64 characters.";
  if (!ID_RULE.test(v)) return "Only letters, digits, - and _.";
  return undefined;
}

function LanguageChecks({
  idPrefix,
  chosen,
  onChange,
}: {
  idPrefix: string;
  chosen: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="ptpl-langs">
      <legend className="ptpl-langs-legend">Approved in</legend>
      {LANGUAGES.map((language) => {
        const id = `${idPrefix}-${language.code}`;
        return (
          <label key={language.code} className="notify-switch ptpl-lang" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={chosen.includes(language.code)}
              data-testid={id}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...chosen, language.code]
                    : chosen.filter((c) => c !== language.code),
                );
              }}
            />
            <span className="notify-switch-label" lang={language.code}>
              {language.label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Map (or change) the approved template a kind uses. Warns — does not refuse —
 * when the last sync has not seen the name APPROVED: Meta's list may simply be
 * older than the approval, and the admin can see the chip either way.
 */
export function MapTemplate({
  kind,
  kindLabel,
  channel,
  current,
  currentLanguages,
  approvedNames,
  syncKnown,
}: {
  kind: string;
  kindLabel: string;
  channel: "whatsapp" | "sms";
  current: string | null;
  currentLanguages: readonly string[] | null;
  approvedNames: readonly string[];
  syncKnown: boolean;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [languages, setLanguages] = useState<string[]>([...(currentLanguages ?? ["en", "hi"])]);
  const [note, setNote] = useState("");
  const problem = nameProblem(channel, value);
  const trimmed = value.trim();
  const unapproved =
    channel === "whatsapp" && syncKnown && trimmed !== "" && !approvedNames.includes(trimmed);
  const valid =
    trimmed !== "" &&
    problem === undefined &&
    note.trim().length <= NOTE_MAX &&
    (channel === "sms" || languages.length > 0);
  const what = channel === "whatsapp" ? "template name" : "DLT template ID";
  const idPrefix = `tpl-map-${channel}-${kind}`;
  return (
    <>
      <Button
        variant="secondary"
        size="touch"
        onClick={() => {
          setValue(current ?? "");
          setLanguages([...(currentLanguages ?? ["en", "hi"])]);
          setNote("");
          setOpen(true);
        }}
        data-testid={`${idPrefix}-open`}
      >
        {current === null ? "Map" : "Change"}
        <span className="admin-sr-only">
          {" "}
          the {what} for {kindLabel}
        </span>
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`${channel === "whatsapp" ? "WhatsApp" : "SMS"} template for ${kindLabel}`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={!valid}
              onClick={() => {
                run(
                  () =>
                    mapProviderTemplate(
                      kind,
                      channel,
                      trimmed,
                      channel === "whatsapp" ? languages : undefined,
                      note,
                    ),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid={`${idPrefix}-save`}
            >
              Use this {channel === "whatsapp" ? "name" : "ID"}
            </Button>
          </>
        }
      >
        <p>
          {channel === "whatsapp"
            ? "The name Meta approved the template under, exactly as WhatsApp Manager shows it. Every message of this kind goes out under it from the next send; the server setting underneath is kept, and Clear goes back to it."
            : "The DLT template ID registered for this message. SMS goes out only once an SMS gateway is set up."}
        </p>
        <Field
          label={channel === "whatsapp" ? "Template name" : "DLT template ID"}
          name={`${idPrefix}-value`}
          value={value}
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={channel === "whatsapp" ? NAME_MAX : 64}
          data-testid={`${idPrefix}-value`}
          {...(problem === undefined ? {} : { error: problem })}
          help={
            channel === "whatsapp"
              ? "Lowercase letters, digits and underscores, e.g. da_auction_sold."
              : "Letters, digits, - and _."
          }
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        {channel === "whatsapp" ? (
          <LanguageChecks idPrefix={idPrefix} chosen={languages} onChange={setLanguages} />
        ) : null}
        {unapproved ? (
          <Notice tone="warning" icon={<IconAlert size={20} />} testId={`${idPrefix}-warning`}>
            Meta&rsquo;s last status sync has no APPROVED template called &ldquo;{trimmed}&rdquo;.
            Until Meta approves it every send of this kind is refused, and the message goes by email
            only. Refresh from Meta first if it was approved just now.
          </Notice>
        ) : null}
        <Field
          label="Note (optional)"
          name={`${idPrefix}-note`}
          value={note}
          maxLength={NOTE_MAX}
          autoComplete="off"
          help="Why — kept with the mapping and on the audit log."
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Dialog>
    </>
  );
}

/** Drop the mapping: the server setting decides again. */
export function ClearTemplate({
  kind,
  kindLabel,
  channel,
  fallback,
}: {
  kind: string;
  kindLabel: string;
  channel: "whatsapp" | "sms";
  fallback: string | null;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="ghost"
      size="touch"
      loading={pending}
      onClick={() => {
        run(() => clearProviderTemplate(kind, channel));
      }}
      data-testid={`tpl-clear-${channel}-${kind}`}
      title={
        fallback === null
          ? "No server setting underneath: the moment will have no template."
          : `Falls back to the server setting: ${fallback}`
      }
    >
      Clear mapping<span className="admin-sr-only"> for {kindLabel}</span>
    </Button>
  );
}

/** One click for a name this kind was submitted under that Meta has approved. */
export function UseApprovedName({
  kind,
  kindLabel,
  name,
}: {
  kind: string;
  kindLabel: string;
  name: string;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="primary"
      size="touch"
      loading={pending}
      onClick={() => {
        run(() => mapProviderTemplate(kind, "whatsapp", name, ["en", "hi"], "Approved by Meta"));
      }}
      data-testid={`tpl-use-${kind}-${name}`}
    >
      Use {name}
      <span className="admin-sr-only"> for {kindLabel}</span>
    </Button>
  );
}

export function RefreshFromMeta() {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="touch"
      loading={pending}
      onClick={() => {
        run(() => refreshTemplateStatus());
      }}
      data-testid="tpl-refresh"
    >
      Refresh from Meta
    </Button>
  );
}

export interface PreviewLanguage {
  readonly language: string;
  readonly languageLabel: string;
  readonly body: string;
  readonly footer: string;
  readonly button: string;
  readonly buttonUrl: string;
  readonly samples: readonly string[];
  readonly json: string;
}

/**
 * Submit the catalogue's own template to Meta. The dialog shows EXACTLY what
 * goes — the body per language, its samples, footer and button, and the JSON
 * itself — because an approved template cannot be edited afterwards.
 */
export function SubmitTemplate({
  kind,
  kindLabel,
  suggestedName,
  preview,
}: {
  kind: string;
  kindLabel: string;
  suggestedName: string;
  preview: readonly PreviewLanguage[];
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [languages, setLanguages] = useState<string[]>(["en", "hi"]);
  const problem = nameProblem("whatsapp", name);
  const valid = name.trim() !== "" && problem === undefined && languages.length > 0;
  const idPrefix = `tpl-submit-${kind}`;
  return (
    <>
      <Button
        variant="secondary"
        size="touch"
        onClick={() => {
          setName(suggestedName);
          setLanguages(["en", "hi"]);
          setOpen(true);
        }}
        data-testid={`${idPrefix}-open`}
      >
        Submit to Meta…<span className="admin-sr-only"> — {kindLabel}</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`Submit ${kindLabel} to Meta for approval`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={pending}
              disabled={!valid}
              onClick={() => {
                run(
                  () => submitProviderTemplate(kind, name.trim(), languages),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid={`${idPrefix}-confirm`}
            >
              Submit for approval
            </Button>
          </>
        }
      >
        <p>
          Meta reviews it as a <strong>Utility</strong> template, usually within a day. An approved
          template cannot be edited — a new wording is a new name. Once Meta approves it, map the
          name here; nothing changes for players until you do.
        </p>
        <Field
          label="Template name"
          name={`${idPrefix}-name`}
          value={name}
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={NAME_MAX}
          data-testid={`${idPrefix}-name`}
          {...(problem === undefined ? {} : { error: problem })}
          help="Lowercase letters, digits and underscores. One name holds both languages."
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <LanguageChecks idPrefix={idPrefix} chosen={languages} onChange={setLanguages} />
        {preview
          .filter((p) => languages.includes(p.language))
          .map((p) => (
            <section
              key={p.language}
              className="ptpl-preview"
              aria-label={`What Meta receives in ${p.languageLabel}`}
              data-testid={`${idPrefix}-preview-${p.language}`}
            >
              <h3 className="ptpl-preview-title">{p.languageLabel}</h3>
              <p className="ptpl-preview-body" lang={p.language}>
                {p.body}
              </p>
              <p className="admin-meta">
                Footer: {p.footer} · Button: <span lang={p.language}>{p.button}</span> →{" "}
                {p.buttonUrl}
              </p>
              <p className="admin-meta">
                Samples:{" "}
                {p.samples.map((sample, i) => `{{${String(i + 1)}}} ${sample}`).join(" · ")}
              </p>
              <details className="ptpl-json">
                <summary>The exact request</summary>
                <pre>{p.json.replace(/"name": "[^"]*"/, `"name": "${name.trim()}"`)}</pre>
              </details>
            </section>
          ))}
      </Dialog>
    </>
  );
}

export function RevertTemplate({ auditId, summary }: { auditId: string; summary: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="touch"
      loading={pending}
      onClick={() => {
        run(() => revertProviderTemplate(auditId));
      }}
      aria-label={`Revert: ${summary}`}
      data-testid={`tpl-revert-${auditId}`}
    >
      Revert
    </Button>
  );
}
