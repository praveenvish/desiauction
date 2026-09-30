import {
  EmptyState,
  IconChevronLeft,
  IconMail,
  IconTile,
  Pill,
  ToastProvider,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { platformAdminPageGate } from "../../../../../server/admin/authz";
import {
  adminTemplateEditor,
  type LanguageView,
  type TemplateEditorView,
} from "../../../../../server/admin/template-views";
import { RelativeTime } from "../../../admin-ui";
import { RestoreButton, TemplateEditor } from "./template-editor";
import { AdminPageHead } from "../../../admin-ui";
import { NotifySubnav } from "../../notify-subnav";
import "../../../../seasons/seasons.css";
import "../../../admin.css";
import "../../notifications.css";
import "./template-editor.css";

export const metadata = { title: "Email wording · Notifications · Platform admin" };

/**
 * THE EMAIL WORDING EDITOR (Notification Control Center, Phase 2).
 *
 * One email kind, in each language it is sent in: the words an operator may
 * change, a preview rendered by the real renderer, and every version that ever
 * went out. Behind `platform.admin` and nothing new (founder decision,
 * 2026-09-23); a not-found for everyone else, and for a kind whose wording is
 * code-only, like every other admin surface.
 *
 * Rendered whole, no Suspense — the Phase 1 lesson: this page is changed by its
 * own actions, and a streamed boundary kept showing the view from before the
 * change after `router.refresh()`.
 */

const CATEGORY: Record<TemplateEditorView["category"], { label: string; tone: KitTone }> = {
  login: { label: "Sign-in", tone: "neutral" },
  security: { label: "Security", tone: "red" },
  transactional: { label: "Transactional", tone: "blue" },
  operational: { label: "Our team", tone: "purple" },
  promotional: { label: "Promotional", tone: "amber" },
};

function decoded(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape ("%E0") is an address that names nothing — a 404,
    // not a 500.
    return null;
  }
}

export default async function EmailWordingPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: raw } = await params;
  const kind = decoded(raw);
  if (kind === null || (await platformAdminPageGate("notifications", kind)) === null) {
    notFound();
  }
  const view = await adminTemplateEditor(kind);
  if (view === null) {
    notFound();
  }
  const category = CATEGORY[view.category];
  // The history is rendered HERE, on the server, and handed to the editor as a
  // slot per language: `RelativeTime` reads the clock, and a client render of
  // it would disagree with the server's by however long hydration took.
  const history: Record<string, ReactNode> = {};
  for (const language of view.languages) {
    history[language.language] = <History view={view} language={language} />;
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            <NotifySubnav current="email" />
          </AdminPageHead>
          <p className="admin-lede admin-lede-under">
            The words of one email. Links, layout and facts stay ours; a publish is audited and can
            be undone.
          </p>

          {/* The email, named once, with the way back to its message — the
              page is a message's wording, opened from its panel. */}
          <header className="msg-card tpl-kind" data-testid="template-kind">
            <Link
              href={`/admin/notifications?kind=${encodeURIComponent(view.kind)}`}
              className="msg-link tpl-kind-back"
            >
              <IconChevronLeft size={16} />
              Back to the message
            </Link>
            <div className="tpl-kind-main">
              <IconTile icon={<IconMail />} tone="neutral" size="sm" />
              <div className="tpl-kind-text">
                <span className="msg-eyebrow">Email wording</span>
                <h2 className="tpl-kind-title">{view.label}</h2>
                <p className="tpl-kind-desc">{view.description}</p>
              </div>
              <div className="tpl-kind-facts">
                <Pill tone={category.tone}>{category.label}</Pill>
                <Pill tone="neutral">
                  {view.spec.format === "layout" ? "Branded email" : "Plain-text email"}
                </Pill>
              </div>
            </div>
            {view.spec.note === undefined ? null : (
              <p className="tpl-kind-note" data-testid="template-note">
                {view.spec.note}
              </p>
            )}
          </header>

          <TemplateEditor view={view} history={history} />

          <section
            className="msg-card msg-recent"
            aria-labelledby="tpl-changes-title"
            data-testid="template-changes"
          >
            <header className="msg-recent-head">
              <h2 id="tpl-changes-title">Recent changes</h2>
              <span>
                The last twenty publishes, restores, resets and test sends of this email, newest
                first
              </span>
            </header>
            {view.changes.length === 0 ? (
              <EmptyState
                size="compact"
                headingLevel={3}
                title="Nothing changed yet"
                description="This email still uses DesiAuction's default wording in every language."
              />
            ) : (
              <ul className="msg-recent-list">
                {view.changes.map((change) => (
                  <li key={change.id}>
                    <span className="msg-recent-dot" aria-hidden />
                    <span className="msg-recent-text">
                      <span className="msg-change-line">{change.summary}</span>
                      <span className="msg-change-meta">
                        {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </ToastProvider>
  );
}

const STATUS_LABEL = { draft: "Draft", published: "Published", archived: "Earlier" } as const;
const STATUS_TONE: Record<keyof typeof STATUS_LABEL, KitTone> = {
  draft: "amber",
  published: "green",
  archived: "neutral",
};

/**
 * Every version of one language, newest first. An earlier version that still
 * parses can be restored — as a NEW version, so the history only ever grows.
 * One whose stored wording no longer parses is shown and never offered.
 */
function History({ view, language }: { view: TemplateEditorView; language: LanguageView }) {
  if (language.history.length === 0) {
    return (
      <p className="tpl-quiet" data-testid="template-history">
        No versions yet — this language still uses the default wording.
      </p>
    );
  }
  return (
    <ol className="tpl-history" data-testid="template-history">
      {language.history.map((version) => {
        const who =
          version.status === "published" || version.status === "archived"
            ? (version.publishedByName ?? version.createdByName)
            : version.createdByName;
        const when =
          version.status !== "draft" && version.publishedAt !== null
            ? version.publishedAt
            : version.createdAt;
        return (
          <li key={version.version} data-testid={`template-version-${String(version.version)}`}>
            <span className="admin-cell-main">
              <span className="tpl-history-head">
                <span className="admin-name">v{version.version}</span>
                <Pill tone={STATUS_TONE[version.status]}>{STATUS_LABEL[version.status]}</Pill>
              </span>
              <span className="admin-meta">
                {who ?? "An operator"} · <RelativeTime at={when} />
              </span>
              {version.note === null ? null : (
                <span className="admin-meta">Note: {version.note}</span>
              )}
              {version.content === null ? (
                <span className="admin-meta">
                  This version no longer matches the email&rsquo;s shape, so it cannot be restored.
                </span>
              ) : null}
            </span>
            {version.status === "archived" && version.content !== null ? (
              <RestoreButton
                kind={view.kind}
                language={language.language}
                languageLabel={language.label}
                version={version.version}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
