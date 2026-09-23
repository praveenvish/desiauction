"use client";

import {
  FIELD_LIMITS,
  validateTemplate,
  type LockedBlock,
  type MessageLanguage,
  type TemplateContent,
  type TemplateField,
  type TemplateFields,
  type TemplateIssue,
} from "@desiauction/messaging/email-templates";
import {
  Button,
  Field,
  IconLock,
  IconPencil,
  IconSend,
  Notice,
  Pill,
  SectionCard,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  previewTemplateAction,
  publishTemplateAction,
  resetTemplateAction,
  restoreTemplateVersionAction,
  saveTemplateDraftAction,
  sendTemplateTestAction,
  type TemplateActionResult,
} from "../../../../../server/admin/template-actions";
import type { LanguageView, TemplateEditorView } from "../../../../../server/admin/template-views";

/**
 * THE EMAIL WORDING EDITOR — the only interactive part of
 * /admin/notifications/[kind]/email.
 *
 * What it holds is the operator's UNSAVED wording, per language, and nothing
 * the server owns: every status, version and history row is the page's props,
 * and every write ends in `router.refresh()` so what is shown afterwards is the
 * server's answer. The rules are the server's too — `validateTemplate` is the
 * same pure function the writer runs at save, at publish and at render, so an
 * inline error here and a refusal there cannot disagree.
 *
 * Plain text inputs, on purpose: the wording IS plain text (the validator
 * refuses markup), and a rich-text box would promise bold it cannot deliver.
 */

type Field1 = "subject" | "preheader" | "heading" | "footnote";
type ListField = "paragraphs" | "after";

/** Where a `{{value}}` chip writes: the field the operator was last typing in. */
type Target =
  | { readonly field: Field1 }
  | { readonly field: ListField; readonly index: number }
  | { readonly field: "actions"; readonly id: string };

const FIELD_NAMES: Record<TemplateField, string> = {
  subject: "Subject",
  preheader: "Preview line",
  heading: "Heading",
  paragraphs: "Opening paragraphs",
  after: "Closing paragraphs",
  actions: "Button labels",
  footnote: "Footnote",
};

const LIST_ITEM: Record<ListField, string> = {
  paragraphs: "Opening paragraph",
  after: "Closing paragraph",
};

const LIST_MAX: Record<ListField, number> = {
  paragraphs: FIELD_LIMITS.paragraphs,
  after: FIELD_LIMITS.after,
};

const SINGLE_LIMIT: Record<Field1, number> = {
  subject: FIELD_LIMITS.subject,
  preheader: FIELD_LIMITS.preheader,
  heading: FIELD_LIMITS.heading,
  footnote: FIELD_LIMITS.footnote,
};

// ---------------------------------------------------------------------------
// Where the editing starts, and the unsaved wording on top of it.
// ---------------------------------------------------------------------------

interface StartingPoint {
  readonly content: TemplateContent;
  readonly source: string;
}

/**
 * Every variant the spec has, whatever the stored row carried: a variant added
 * to the code after a version was published starts from its default rather
 * than leaving a hole the validator can only call "missing".
 */
function complete(content: TemplateContent, fallback: TemplateContent): TemplateContent {
  const variants: Record<string, TemplateFields> = {};
  for (const [id, fields] of Object.entries(fallback.variants)) {
    variants[id] = content.variants[id] ?? fields;
  }
  return { variants };
}

/** The draft if one waits, else what goes out now, else the code's default. */
function startingPoint(language: LanguageView): StartingPoint {
  if (language.draft !== null && language.draft.content !== null) {
    const by = language.draft.createdByName;
    return {
      content: complete(language.draft.content, language.defaultContent),
      source: `Editing the draft v${String(language.draft.version)}${by === null ? "" : `, saved by ${by}`}`,
    };
  }
  if (language.published !== null && language.published.content !== null) {
    return {
      content: complete(language.published.content, language.defaultContent),
      source: `Editing the published v${String(language.published.version)}`,
    };
  }
  return { content: language.defaultContent, source: "Editing the default wording" };
}

/**
 * The versions the unsaved wording was started against. When a refresh brings
 * a different pair — this operator published, or another one did — the edits
 * lapse on their own and the editor starts again from the new state: no
 * effect, no reset, the same shape as Phase 1's `useIntended`.
 */
function signatureOf(language: LanguageView): string {
  return `${String(language.published?.version ?? "-")}/${String(language.draft?.version ?? "-")}`;
}

function statusText(language: LanguageView): string {
  const live =
    language.status.state === "published"
      ? `Published v${String(language.status.version)}`
      : "Default";
  return language.draft === null ? live : `${live} · Draft v${String(language.draft.version)}`;
}

function same(a: TemplateContent, b: TemplateContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function issueKey(issue: TemplateIssue): string {
  return `${issue.variant ?? ""}|${issue.field ?? ""}|${String(issue.index ?? "")}|${issue.message}`;
}

function describedBy(...ids: (string | null | undefined | false)[]): string | undefined {
  const joined = ids.filter((id): id is string => typeof id === "string" && id !== "").join(" ");
  return joined === "" ? undefined : joined;
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

const UNREACHED: TemplateActionResult = {
  ok: false,
  error: "That did not reach the server. Nothing was changed.",
};

/** One write at a time: a toast either way, and the server's page after a success. */
function useWrite() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (
    act: () => Promise<TemplateActionResult>,
    handlers: {
      onOk?: () => void;
      onFail?: (result: Extract<TemplateActionResult, { ok: false }>) => void;
    } = {},
  ) => {
    start(async () => {
      let result: TemplateActionResult;
      try {
        result = await act();
      } catch {
        result = UNREACHED;
      }
      if (!result.ok) {
        handlers.onFail?.(result);
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.message, tone: "success" });
      handlers.onOk?.();
      router.refresh();
    });
  };
  return { pending, run };
}

// ---------------------------------------------------------------------------
// Small controls.
// ---------------------------------------------------------------------------

/** Next / previous / first / last for a roving set, as the APG asks. */
function rovingIndex(key: string, index: number, length: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

/**
 * A segmented radio group (variant, preview width, preview theme): one tab
 * stop, arrows move and select — the APG radio group, drawn as segments.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  testIdPrefix?: string;
}) {
  const base = useId();
  const labelId = `${base}-label`;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rovingIndex(event.key, index, options.length);
    const option = next === null ? undefined : options[next];
    if (option === undefined) return;
    event.preventDefault();
    onChange(option.id);
    document.getElementById(`${base}-${option.id}`)?.focus();
  };
  return (
    <div className="tpl-segmented-wrap">
      <span id={labelId} className="tpl-label">
        {label}
      </span>
      <div className="tpl-segmented" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option, index) => (
          <button
            key={option.id}
            id={`${base}-${option.id}`}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            tabIndex={option.id === value ? 0 : -1}
            className="tpl-segment"
            data-testid={testIdPrefix === undefined ? undefined : `${testIdPrefix}${option.id}`}
            onClick={() => {
              onChange(option.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldError({
  id,
  issues,
  testId,
}: {
  id: string;
  issues: readonly TemplateIssue[];
  testId: string;
}) {
  if (issues.length === 0) return null;
  return (
    <ul id={id} className="tpl-error" data-testid={testId}>
      {issues.map((issue) => (
        <li key={issueKey(issue)}>{issue.message}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The editor.
// ---------------------------------------------------------------------------

type Width = "desktop" | "mobile";
type Theme = "light" | "dark";

interface Preview {
  readonly subject: string;
  readonly text: string;
  readonly html: string | null;
}

export function TemplateEditor({
  view,
  history,
}: {
  view: TemplateEditorView;
  /** Each language's version list, rendered on the server (it reads the clock). */
  history: Readonly<Record<string, ReactNode>>;
}) {
  const first = view.languages[0];
  if (first === undefined) {
    // Unreachable: every spec has English (email-template-defaults.test).
    return <Notice tone="danger">This email is not sent in any language.</Notice>;
  }
  return <Editor view={view} history={history} first={first} />;
}

function Editor({
  view,
  history,
  first,
}: {
  view: TemplateEditorView;
  history: Readonly<Record<string, ReactNode>>;
  first: LanguageView;
}) {
  const { spec } = view;
  const base = useId();
  const id = (...parts: (string | number)[]) => `${base}-${parts.join("-")}`;
  const { pending, run } = useWrite();

  const [languageId, setLanguageId] = useState<MessageLanguage>(first.language);
  const language = view.languages.find((entry) => entry.language === languageId) ?? first;
  const [variant, setVariant] = useState<string>(spec.variants[0]?.id ?? "default");
  const [work, setWork] = useState<
    Partial<Record<MessageLanguage, { against: string; content: TemplateContent } | undefined>>
  >({});
  const [confirm, setConfirm] = useState<"publish" | "reset" | null>(null);
  const [note, setNote] = useState("");
  const [serverIssues, setServerIssues] = useState<{
    content: TemplateContent;
    issues: readonly TemplateIssue[];
  } | null>(null);
  const [insertHint, setInsertHint] = useState("");
  const [acting, setActing] = useState<"draft" | "test" | null>(null);
  const [width, setWidth] = useState<Width>("desktop");
  const [theme, setTheme] = useState<Theme>("light");

  // State, not refs: both are written from handlers the render builds, and
  // the compiler (rightly) will not let a render reach a ref.
  const [lastTarget, setLastTarget] = useState<{ target: Target; elementId: string } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; caret?: number } | null>(null);
  const focusLater = (elementId: string, caret?: number) => {
    setFocusRequest(caret === undefined ? { id: elementId } : { id: elementId, caret });
  };

  // Focus and caret land AFTER the render that put the new value in place —
  // setting them in the click handler would be undone by React writing the
  // controlled value back. Each request is a new object, so it runs once.
  useLayoutEffect(() => {
    if (focusRequest === null) return;
    const element = document.getElementById(focusRequest.id);
    if (element === null) return;
    element.focus();
    if (
      focusRequest.caret !== undefined &&
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    ) {
      element.setSelectionRange(focusRequest.caret, focusRequest.caret);
    }
  }, [focusRequest]);

  // Memoised on the props, so the starting wording keeps its identity between
  // renders: the server's refusal is matched to the wording it refused by
  // identity, and an un-edited start must stay the same object to match.
  const starts = useMemo(
    () => new Map(view.languages.map((entry) => [entry.language, startingPoint(entry)])),
    [view.languages],
  );
  const startOf = (entry: LanguageView) => starts.get(entry.language) ?? startingPoint(entry);
  const contentOf = (entry: LanguageView): TemplateContent => {
    const mine = work[entry.language];
    return mine !== undefined && mine.against === signatureOf(entry)
      ? mine.content
      : startOf(entry).content;
  };
  const dirtyOf = (entry: LanguageView) => !same(contentOf(entry), startOf(entry).content);

  const start = startOf(language);
  const content = contentOf(language);
  const dirty = dirtyOf(language);
  const fields: TemplateFields | undefined =
    content.variants[variant] ?? language.defaultContent.variants[variant];

  const clientIssues = validateTemplate(spec, content, {
    language: language.language,
    ownHosts: view.ownHosts,
  });
  // The server's own refusal, while the wording it refused is still what is on
  // screen. It should always equal the client's; if it ever does not, it is the
  // server that decides, so it is shown too.
  const extraIssues =
    serverIssues !== null && serverIssues.content === content ? serverIssues.issues : [];
  const seenIssues = new Set<string>();
  const issues = [...clientIssues, ...extraIssues].filter((issue) => {
    const key = issueKey(issue);
    if (seenIssues.has(key)) return false;
    seenIssues.add(key);
    return true;
  });

  const setContent = (next: TemplateContent) => {
    setWork((previous) => ({
      ...previous,
      [language.language]: { against: signatureOf(language), content: next },
    }));
  };
  const updateFields = (change: (current: TemplateFields) => TemplateFields) => {
    if (fields === undefined) return;
    setContent({ variants: { ...content.variants, [variant]: change(fields) } });
  };
  const setTarget = (target: Target, value: string) => {
    updateFields((current) => {
      switch (target.field) {
        case "paragraphs":
        case "after": {
          const list = [...current[target.field]];
          list[target.index] = value;
          return { ...current, [target.field]: list };
        }
        case "actions":
          return { ...current, actions: { ...current.actions, [target.id]: value } };
        default:
          return { ...current, [target.field]: value };
      }
    });
  };

  // ---- Preview: the real renderer, on the server, a beat after typing stops.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "busy" | "failed">("idle");
  const ticket = useRef(0);
  const contentKey = JSON.stringify(content);
  useEffect(() => {
    ticket.current += 1;
    const mine = ticket.current;
    const timer = setTimeout(() => {
      setPreviewState("busy");
      previewTemplateAction(view.kind, language.language, variant, JSON.parse(contentKey))
        .then((result) => {
          if (mine !== ticket.current) return;
          if (!result.ok) {
            // The last good preview stays up; the note under it says why it
            // did not move.
            setPreviewState("failed");
            return;
          }
          setPreview({ subject: result.subject, text: result.text, html: result.html });
          setPreviewState("idle");
        })
        .catch(() => {
          if (mine === ticket.current) setPreviewState("failed");
        });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [view.kind, language.language, variant, contentKey]);

  // ---- Unsaved wording is not lost to a stray tab close.
  const anyDirty = view.languages.some((entry) => dirtyOf(entry));
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [anyDirty]);

  // ---- Value chips: insert at the caret of the field last typed in.
  const insert = (name: string) => {
    const last = lastTarget;
    const element = last === null ? null : document.getElementById(last.elementId);
    if (
      last === null ||
      !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
      element.readOnly
    ) {
      setInsertHint("Click into a field first, then choose the value to put there.");
      return;
    }
    const token = `{{${name}}}`;
    const from = element.selectionStart ?? element.value.length;
    const to = element.selectionEnd ?? from;
    setTarget(last.target, `${element.value.slice(0, from)}${token}${element.value.slice(to)}`);
    focusLater(last.elementId, from + token.length);
    setInsertHint(`Added ${token}.`);
  };
  const track = (target: Target, elementId: string) => () => {
    if (lastTarget?.elementId !== elementId) setLastTarget({ target, elementId });
  };

  const chooseLanguage = (next: MessageLanguage) => {
    setLanguageId(next);
    setConfirm(null);
    setLastTarget(null);
  };
  const chooseVariant = (next: string) => {
    setVariant(next);
    setLastTarget(null);
  };

  // ---- Issues, by where they are shown.
  const here = (issue: TemplateIssue) => issue.variant === variant;
  const fieldIssues = (field: TemplateField) =>
    issues.filter((issue) => here(issue) && issue.field === field && issue.index === undefined);
  const itemIssues = (field: ListField, index: number) =>
    issues.filter((issue) => here(issue) && issue.field === field && issue.index === index);
  const variantLabel = (variantId: string | null) =>
    spec.variants.find((entry) => entry.id === variantId)?.label ?? variantId ?? "";
  const whereOf = (issue: TemplateIssue): string => {
    const field =
      issue.field === null
        ? null
        : (issue.field === "paragraphs" || issue.field === "after") && issue.index !== undefined
          ? `${LIST_ITEM[issue.field]} ${String(issue.index + 1)}`
          : FIELD_NAMES[issue.field];
    const inVariant =
      spec.variants.length > 1 && issue.variant !== null ? variantLabel(issue.variant) : null;
    return [inVariant, field].filter((part): part is string => part !== null).join(" · ");
  };

  const blocked = issues.length > 0;
  const editable = (field: TemplateField) => spec.editableFields.includes(field);
  const fixedFields =
    spec.format === "layout"
      ? (Object.keys(FIELD_NAMES) as TemplateField[]).filter(
          (field) => !editable(field) && (field !== "actions" || spec.actions.length > 0),
        )
      : [];

  // ---- Writes.
  const refused = (result: Extract<TemplateActionResult, { ok: false }>) => {
    if (result.issues !== undefined && result.issues.length > 0) {
      setServerIssues({ content, issues: result.issues });
    }
  };
  const saveDraft = () => {
    setActing("draft");
    run(() => saveTemplateDraftAction(view.kind, language.language, content), { onFail: refused });
  };
  const publish = () => {
    const trimmed = note.trim();
    run(
      () =>
        publishTemplateAction(
          view.kind,
          language.language,
          content,
          trimmed === "" ? undefined : trimmed,
        ),
      {
        onOk: () => {
          setConfirm(null);
          setNote("");
        },
        onFail: refused,
      },
    );
  };
  const reset = () => {
    run(() => resetTemplateAction(view.kind, language.language), {
      onOk: () => {
        setConfirm(null);
      },
    });
  };
  const sendTest = () => {
    setActing("test");
    run(() => sendTemplateTestAction(view.kind, language.language, variant, content), {
      onFail: refused,
    });
  };
  const discard = () => {
    setWork((previous) => ({ ...previous, [language.language]: undefined }));
    setLastTarget(null);
  };

  const testBlocked =
    view.operatorEmail === null
      ? "Add and confirm an email address on your account to send yourself a test."
      : view.testSendsLeft <= 0
        ? "No test emails left this hour — the limit is ten."
        : null;

  // ---- The tabs.
  const tabId = (entry: MessageLanguage) => id("tab", entry);
  const panelId = id("panel");
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rovingIndex(event.key, index, view.languages.length);
    const entry = next === null ? undefined : view.languages[next];
    if (entry === undefined || event.key === "ArrowUp" || event.key === "ArrowDown") return;
    event.preventDefault();
    chooseLanguage(entry.language);
    document.getElementById(tabId(entry.language))?.focus();
  };

  // ---- One single-line (or one-paragraph) field.
  const single = (field: Field1, label: string, hint: string, multiline = false) => {
    if (fields === undefined || !editable(field)) return null;
    const value = fields[field];
    const controlId = id(field);
    const hintId = id(field, "hint");
    const errorId = id(field, "error");
    const own = fieldIssues(field);
    const shared = {
      id: controlId,
      value,
      lang: language.language,
      className: "tpl-control",
      "aria-invalid": own.length > 0 || undefined,
      "aria-describedby": describedBy(hintId, own.length > 0 && errorId),
      "data-testid": `template-${field}`,
      onFocus: track({ field }, controlId),
    };
    return (
      <div className="tpl-field">
        <label className="tpl-label" htmlFor={controlId}>
          {label}
        </label>
        {multiline ? (
          <textarea
            {...shared}
            rows={2}
            onChange={(event) => {
              setTarget({ field }, event.target.value);
            }}
            onKeyDown={(event) => {
              // One paragraph: Enter would only earn a "keep this to one line".
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        ) : (
          <input
            {...shared}
            type="text"
            autoComplete="off"
            onChange={(event) => {
              setTarget({ field }, event.target.value);
            }}
          />
        )}
        <span id={hintId} className="tpl-hint">
          {hint} {String(value.length)} of {String(SINGLE_LIMIT[field])} characters.
        </span>
        <FieldError id={errorId} issues={own} testId={`template-error-${field}`} />
      </div>
    );
  };

  // ---- A list of paragraphs, with its locked lines.
  const list = (field: ListField, title: string, hint: string) => {
    if (fields === undefined || !editable(field)) return null;
    const items = fields[field];
    const locked = spec.locked.filter(
      (block) =>
        block.field === field && (block.variants === undefined || block.variants.includes(variant)),
    );
    const lockOf = (text: string): LockedBlock | undefined =>
      locked.find((block) => block.text[language.language] === text);
    const missing = locked.filter((block) => !items.includes(block.text[language.language]));
    const groupId = id(field, "group");
    const groupErrorId = id(field, "error");
    const groupIssues = fieldIssues(field);
    const itemName = spec.format === "layout" ? LIST_ITEM[field] : "Paragraph";
    const move = (from: number, to: number, focusId: string) => {
      updateFields((current) => {
        const next = [...current[field]];
        const [moved] = next.splice(from, 1);
        if (moved !== undefined) next.splice(to, 0, moved);
        return { ...current, [field]: next };
      });
      setLastTarget(null);
      focusLater(focusId);
    };
    const remove = (index: number) => {
      updateFields((current) => ({
        ...current,
        [field]: current[field].filter((_, at) => at !== index),
      }));
      setLastTarget(null);
      const after = items.length - 1;
      focusLater(after === 0 ? id(field, "add") : id(field, Math.min(index, after - 1)));
    };
    const add = (text: string) => {
      updateFields((current) => ({ ...current, [field]: [...current[field], text] }));
      focusLater(id(field, items.length));
    };
    return (
      <fieldset
        className="tpl-list"
        aria-describedby={describedBy(id(field, "hint"), groupIssues.length > 0 && groupErrorId)}
      >
        <legend className="tpl-label" id={groupId}>
          {title}
        </legend>
        <span id={id(field, "hint")} className="tpl-hint">
          {hint}
        </span>
        <FieldError id={groupErrorId} issues={groupIssues} testId={`template-error-${field}`} />
        {items.length === 0 ? <p className="tpl-quiet">No paragraphs here.</p> : null}
        <ol className="tpl-items">
          {items.map((text, index) => {
            const controlId = id(field, index);
            const lock = lockOf(text);
            const own = itemIssues(field, index);
            const errorId = id(field, index, "error");
            const whyId = id(field, index, "why");
            const number = String(index + 1);
            return (
              // Index keys on purpose: a move swaps the VALUES under two
              // textareas that stay put, so focus follows the button, not the text.
              <li
                key={index}
                className="tpl-item"
                data-locked={lock === undefined ? undefined : "true"}
              >
                <div className="tpl-item-head">
                  <label className="tpl-item-label" htmlFor={controlId}>
                    {itemName} {number}
                  </label>
                  {lock === undefined ? null : (
                    <Pill tone="neutral" icon={<IconLock size={14} />}>
                      Locked
                    </Pill>
                  )}
                </div>
                <textarea
                  id={controlId}
                  className="tpl-control tpl-paragraph"
                  value={text}
                  lang={language.language}
                  rows={3}
                  readOnly={lock !== undefined}
                  aria-invalid={own.length > 0 || undefined}
                  aria-describedby={describedBy(
                    lock !== undefined && whyId,
                    own.length > 0 && errorId,
                  )}
                  data-testid={`template-${field}-${String(index)}`}
                  onFocus={lock === undefined ? track({ field, index }, controlId) : undefined}
                  onChange={(event) => {
                    if (lock === undefined) setTarget({ field, index }, event.target.value);
                  }}
                />
                {lock === undefined ? null : (
                  <span id={whyId} className="tpl-hint">
                    Cannot be changed or removed: {lock.why}
                  </span>
                )}
                <FieldError
                  id={errorId}
                  issues={own}
                  testId={`template-error-${field}-${String(index)}`}
                />
                <div className="tpl-item-tools">
                  <Button
                    variant="ghost"
                    size="touch"
                    id={id(field, index, "up")}
                    disabled={index === 0}
                    aria-label={`Move ${itemName.toLowerCase()} ${number} up`}
                    onClick={() => {
                      // Focus rides with the moved paragraph — onto the other
                      // arrow when this one has just become disabled.
                      move(index, index - 1, id(field, index - 1, index === 1 ? "down" : "up"));
                    }}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="ghost"
                    size="touch"
                    id={id(field, index, "down")}
                    disabled={index === items.length - 1}
                    aria-label={`Move ${itemName.toLowerCase()} ${number} down`}
                    onClick={() => {
                      move(
                        index,
                        index + 1,
                        id(field, index + 1, index + 1 === items.length - 1 ? "up" : "down"),
                      );
                    }}
                  >
                    Move down
                  </Button>
                  {lock === undefined ? (
                    <Button
                      variant="ghost"
                      size="touch"
                      aria-label={`Remove ${itemName.toLowerCase()} ${number}`}
                      onClick={() => {
                        remove(index);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="tpl-list-tools">
          <Button
            variant="secondary"
            size="touch"
            id={id(field, "add")}
            disabled={items.length >= LIST_MAX[field]}
            data-testid={field === "paragraphs" ? "template-add-paragraph" : "template-add-after"}
            onClick={() => {
              add("");
            }}
          >
            Add paragraph
            <span className="admin-sr-only"> to {title.toLowerCase()}</span>
          </Button>
          {missing.map((block) => (
            <Button
              key={block.id}
              variant="secondary"
              size="touch"
              data-testid={`template-restore-locked-${block.id}`}
              onClick={() => {
                add(block.text[language.language]);
              }}
            >
              Put back the locked line
            </Button>
          ))}
          {items.length >= LIST_MAX[field] ? (
            <span className="tpl-hint">At most {String(LIST_MAX[field])} paragraphs here.</span>
          ) : null}
        </div>
      </fieldset>
    );
  };

  // ---- Button labels.
  const actionFields = () => {
    if (fields === undefined || !editable("actions") || spec.actions.length === 0) return null;
    const groupIssues = fieldIssues("actions");
    const errorId = id("actions", "error");
    return (
      <div className="tpl-field-group">
        {spec.actions.map((action, index) => {
          const controlId = id("action", action.id);
          const hintId = id("action", action.id, "hint");
          return (
            <div className="tpl-field" key={action.id}>
              <label className="tpl-label" htmlFor={controlId}>
                {spec.actions.length === 1 ? "Button label" : `Button ${String(index + 1)} label`}
              </label>
              <input
                id={controlId}
                type="text"
                autoComplete="off"
                className="tpl-control"
                lang={language.language}
                value={fields.actions[action.id] ?? ""}
                aria-invalid={groupIssues.length > 0 || undefined}
                aria-describedby={describedBy(hintId, groupIssues.length > 0 && errorId)}
                data-testid={`template-action-${action.id}`}
                onFocus={track({ field: "actions", id: action.id }, controlId)}
                onChange={(event) => {
                  setTarget({ field: "actions", id: action.id }, event.target.value);
                }}
              />
              <span id={hintId} className="tpl-hint">
                Opens {action.description.charAt(0).toLowerCase()}
                {action.description.slice(1)} The link itself is set by DesiAuction.
              </span>
            </div>
          );
        })}
        <FieldError id={errorId} issues={groupIssues} testId="template-error-actions" />
      </div>
    );
  };

  const layout = spec.format === "layout";

  return (
    <SectionCard
      icon={<IconPencil />}
      tone="gold"
      title="Wording"
      description="Each language is edited, published and undone on its own."
      data-testid="template-editor"
    >
      {/* The tab list is a container, not a stop: focus belongs to its tabs,
          one of which is in the tab order (see packages/ui tabs.tsx). */}
      <div className="tpl-tabs" role="tablist" aria-label="Language">
        {view.languages.map((entry, index) => {
          const selected = entry.language === language.language;
          return (
            <button
              key={entry.language}
              id={tabId(entry.language)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              className="tpl-tab"
              data-testid={`template-lang-${entry.language}`}
              onClick={() => {
                chooseLanguage(entry.language);
              }}
              onKeyDown={(event) => {
                onTabKey(event, index);
              }}
            >
              <span className="tpl-tab-name" lang={entry.language}>
                {entry.label}
              </span>
              <span className="tpl-tab-status" data-testid={`template-status-${entry.language}`}>
                {statusText(entry)}
              </span>
              {dirtyOf(entry) ? <span className="tpl-tab-dirty">Unsaved edits</span> : null}
            </button>
          );
        })}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(language.language)}
        className="tpl-panel"
      >
        <div className="tpl-source">
          <p data-testid="template-source">
            {start.source}
            {dirty ? " — with unsaved edits." : "."}
          </p>
          {dirty ? (
            <Button variant="ghost" size="touch" onClick={discard} data-testid="template-discard">
              Discard edits
            </Button>
          ) : null}
        </div>

        {spec.variants.length > 1 ? (
          <div className="tpl-variants">
            <Segmented
              label={`This email has ${String(spec.variants.length)} variants, each edited separately`}
              options={spec.variants.map((entry) => ({ id: entry.id, label: entry.label }))}
              value={variant}
              onChange={chooseVariant}
              testIdPrefix="template-variant-"
            />
          </div>
        ) : null}

        <div className="tpl-workspace">
          <section className="tpl-values" aria-labelledby={id("values")}>
            <h3 className="tpl-subhead" id={id("values")}>
              Values you can use
            </h3>
            <p className="tpl-hint">
              Click into a field, then a value: it goes in where the cursor was. Each is filled in
              per person when the email is sent.
            </p>
            <ul className="tpl-chips">
              {spec.variables.map((variable) => {
                const descId = id("var", variable.name);
                const tags = [
                  variable.required === true ? "must appear" : null,
                  variable.type === "flag" ? "shows its paragraph only when true" : null,
                  variable.type === "list" ? "a list — a paragraph on its own" : null,
                  variable.whenEmpty === "drop" ? "its paragraph is left out when empty" : null,
                  variable.computed === true ? "written by DesiAuction" : null,
                ].filter((tag): tag is string => tag !== null);
                return (
                  <li key={variable.name} className="tpl-chip-row">
                    <button
                      type="button"
                      className="tpl-chip"
                      data-kind={variable.type ?? "text"}
                      aria-describedby={descId}
                      data-testid={`template-var-${variable.name}`}
                      onClick={() => {
                        insert(variable.name);
                      }}
                    >
                      {`{{${variable.name}}}`}
                    </button>
                    <span id={descId} className="tpl-hint">
                      {variable.description}
                      {tags.length > 0 ? ` (${tags.join("; ")})` : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="tpl-hint" role="status">
              {insertHint}
            </p>
          </section>

          <div className="tpl-fields">
            {fields === undefined ? (
              <Notice tone="danger">This variant has no wording to edit.</Notice>
            ) : (
              <>
                {single("subject", "Subject", "The line in the inbox.")}
                {layout
                  ? single(
                      "preheader",
                      "Preview line",
                      "Shown after the subject in most inboxes, never in the email itself.",
                    )
                  : null}
                {layout ? single("heading", "Heading", "The large line at the top.") : null}
                {list(
                  "paragraphs",
                  layout ? "Opening paragraphs" : "Paragraphs",
                  layout
                    ? "Before the code, button or details."
                    : "The whole body of this plain-text email.",
                )}
                {layout
                  ? list(
                      "after",
                      "Closing paragraphs",
                      "After the code, button or details. May be empty.",
                    )
                  : null}
                {layout ? actionFields() : null}
                {layout
                  ? single(
                      "footnote",
                      "Footnote",
                      "Why this person received the email. One paragraph.",
                      true,
                    )
                  : null}
                {fixedFields.length > 0 ? (
                  <p className="tpl-quiet">
                    Fixed by DesiAuction for this email:{" "}
                    {fixedFields.map((field) => FIELD_NAMES[field]).join(", ")}.
                  </p>
                ) : null}
                {!layout ? (
                  <p className="tpl-quiet">
                    A plain-text email: it has no heading, preview line or buttons.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <section className="tpl-preview" aria-labelledby={id("preview")}>
            <h3 className="tpl-subhead" id={id("preview")}>
              Preview
            </h3>
            <p className="tpl-hint">
              Drawn by the same code that sends it, with sample values.
              {previewState === "busy" ? " Updating…" : null}
            </p>
            {layout ? (
              <div className="tpl-preview-tools">
                <Segmented
                  label="Width"
                  options={[
                    { id: "desktop", label: "Desktop" },
                    { id: "mobile", label: "Mobile" },
                  ]}
                  value={width}
                  onChange={setWidth}
                  testIdPrefix="template-preview-"
                />
                <Segmented
                  label="Colours"
                  options={[
                    { id: "light", label: "Light" },
                    { id: "dark", label: "Dark" },
                  ]}
                  value={theme}
                  onChange={setTheme}
                  testIdPrefix="template-preview-"
                />
              </div>
            ) : null}
            {layout && theme === "dark" ? (
              <p className="tpl-hint">
                An approximation: many mail apps invert a light email&rsquo;s colours in dark mode,
                as here. Some leave it light, and a few do something in between.
              </p>
            ) : null}
            {previewState === "failed" ? (
              <p className="tpl-hint" data-testid="template-preview-stale">
                The preview could not be drawn just now — this is the last one that was.
              </p>
            ) : null}
            {preview === null ? (
              <p className="tpl-quiet">Drawing the preview…</p>
            ) : (
              <>
                <p className="tpl-preview-subject" data-testid="template-preview-subject">
                  <span className="tpl-label">Subject:</span> {preview.subject}
                </p>
                {preview.html !== null ? (
                  <div className="tpl-frame-wrap" data-width={width} data-theme-preview={theme}>
                    <iframe
                      className="tpl-frame"
                      title={`Preview of the email, ${width === "desktop" ? "desktop" : "mobile"} width, ${theme} colours`}
                      srcDoc={preview.html}
                      sandbox=""
                      data-testid="template-preview-frame"
                    />
                  </div>
                ) : (
                  <pre
                    className="tpl-plain"
                    lang={language.language}
                    data-testid="template-preview-text"
                  >
                    {preview.text}
                  </pre>
                )}
              </>
            )}
          </section>
        </div>

        <div className="tpl-issues">
          <p role="alert" className="tpl-issue-count" data-testid="template-issue-count">
            {blocked
              ? `${String(issues.length)} ${issues.length === 1 ? "thing" : "things"} to fix before this can be saved, published or sent as a test.`
              : ""}
          </p>
          {blocked ? (
            <ul className="tpl-issue-list">
              {issues.map((issue) => {
                const where = whereOf(issue);
                return (
                  <li key={issueKey(issue)}>
                    {where === "" ? null : <strong>{where}: </strong>}
                    {issue.message}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="tpl-actions">
          <Button
            variant="secondary"
            size="touch"
            loading={pending && acting === "draft"}
            disabled={blocked || pending}
            onClick={saveDraft}
            data-testid="template-save-draft"
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            size="touch"
            id={id("publish")}
            disabled={blocked || pending}
            aria-expanded={confirm === "publish"}
            onClick={() => {
              setConfirm(confirm === "publish" ? null : "publish");
            }}
            data-testid="template-publish"
          >
            Publish…
          </Button>
          {language.published !== null ? (
            <Button
              variant="ghost"
              size="touch"
              id={id("reset")}
              disabled={pending}
              aria-expanded={confirm === "reset"}
              onClick={() => {
                setConfirm(confirm === "reset" ? null : "reset");
              }}
              data-testid="template-reset"
            >
              Reset to default…
            </Button>
          ) : null}
        </div>

        {confirm === "publish" ? (
          <div className="tpl-confirm" role="group" aria-labelledby={id("publish", "q")}>
            <p id={id("publish", "q")}>
              Publish this wording in {language.label}? It goes out to everyone who receives &ldquo;
              {view.label}&rdquo;, from the next email sent — there is no review step. The version
              it replaces stays in the history.
            </p>
            <Field
              label="Note (optional)"
              name="template-publish-note"
              value={note}
              maxLength={500}
              autoComplete="off"
              autoFocus
              help="Kept with the version and on the audit log — what changed, and why."
              data-testid="template-publish-note"
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <div className="tpl-actions">
              <Button
                variant="primary"
                size="touch"
                loading={pending}
                disabled={blocked}
                onClick={publish}
                data-testid="template-publish-confirm"
              >
                Publish now
              </Button>
              <Button
                variant="secondary"
                size="touch"
                onClick={() => {
                  setConfirm(null);
                  focusLater(id("publish"));
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {confirm === "reset" && language.published !== null ? (
          <div className="tpl-confirm" role="group" aria-labelledby={id("reset", "q")}>
            <p id={id("reset", "q")}>
              Go back to DesiAuction&rsquo;s default wording in {language.label}? It goes out from
              the next email sent. v{language.published.version} stays in the history and can be
              restored.{dirty ? " Your unsaved edits here are dropped." : ""}
            </p>
            <div className="tpl-actions">
              <Button
                variant="danger"
                size="touch"
                loading={pending}
                autoFocus
                onClick={reset}
                data-testid="template-reset-confirm"
              >
                Reset to default
              </Button>
              <Button
                variant="secondary"
                size="touch"
                onClick={() => {
                  setConfirm(null);
                  focusLater(id("reset"));
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div className="tpl-test">
          <Button
            variant="secondary"
            size="touch"
            loading={pending && acting === "test"}
            disabled={testBlocked !== null || blocked || pending}
            aria-describedby={id("test", "hint")}
            onClick={sendTest}
            data-testid="template-send-test"
          >
            <IconSend size={18} />
            Send test to me
          </Button>
          <span id={id("test", "hint")} className="tpl-hint" data-testid="template-test-hint">
            {testBlocked ??
              `This variant, with sample values, to ${view.operatorEmail ?? ""} only · ${String(view.testSendsLeft)} left this hour.`}
          </span>
        </div>

        <section className="tpl-history-wrap" aria-labelledby={id("history")}>
          <h3 className="tpl-subhead" id={id("history")}>
            Versions in <span lang={language.language}>{language.label}</span>
          </h3>
          {history[language.language] ?? null}
        </section>
      </div>
    </SectionCard>
  );
}

/**
 * "Restore this version", on a row of the server-rendered history. Asks first,
 * inline: a restore publishes at once, as a new version.
 */
export function RestoreButton({
  kind,
  language,
  languageLabel,
  version,
}: {
  kind: string;
  language: string;
  languageLabel: string;
  version: number;
}) {
  const { pending, run } = useWrite();
  const [asking, setAsking] = useState(false);
  const questionId = useId();
  if (!asking) {
    return (
      <Button
        variant="secondary"
        size="touch"
        onClick={() => {
          setAsking(true);
        }}
        aria-label={`Restore version ${String(version)}`}
        data-testid={`template-restore-${String(version)}`}
      >
        Restore this version
      </Button>
    );
  }
  return (
    <div className="tpl-confirm" role="group" aria-labelledby={questionId}>
      <p id={questionId}>
        Publish v{version}&rsquo;s wording again in {languageLabel}, as a new version? It goes out
        to everyone from the next email sent.
      </p>
      <div className="tpl-actions">
        <Button
          variant="primary"
          size="touch"
          loading={pending}
          autoFocus
          onClick={() => {
            run(() => restoreTemplateVersionAction(kind, language, version), {
              onOk: () => {
                setAsking(false);
              },
            });
          }}
          data-testid={`template-restore-confirm-${String(version)}`}
        >
          Restore v{version}
        </Button>
        <Button
          variant="secondary"
          size="touch"
          onClick={() => {
            setAsking(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
