import type { Metadata } from "next";
import Link from "next/link";

import { unsubscribeTokenMatches } from "../../../server/messaging/unsubscribe";
import { switchableTopic } from "../../../server/messaging/unsubscribe-writer";
import { EmailUnsubscribeForm } from "./email-unsubscribe-form";
import "../../content.css";
import "../../marketing.css";

export const metadata: Metadata = {
  title: "Unsubscribe",
  description: "Stop one kind of email from DesiAuction.",
  // A utility page reached only from a mail; nothing here to find.
  robots: { index: false, follow: false },
};

/**
 * Where an email's unsubscribe link lands (and where a mail client's
 * one-click link sends a plain GET). Sign-in free: the link is the proof.
 * Nothing changes until the person presses the button — link scanners open
 * pages, and must never unsubscribe anybody.
 */
export default async function EmailUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { p, topic, t } = await searchParams;
  const valid =
    typeof p === "string" && typeof t === "string" && unsubscribeTokenMatches(p, topic, t);
  const switchTopic = valid && typeof topic === "string" ? await switchableTopic(topic) : undefined;
  if (typeof p !== "string" || typeof t !== "string" || switchTopic === undefined) {
    return (
      <main className="content-page mk">
        <h1>This link doesn&apos;t work any more</h1>
        <p className="content-lead">
          Sign in to choose which emails you get from DesiAuction. Every switch is on one page.
        </p>
        <p>
          <Link href="/account?section=notifications">Open your email settings</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="content-page mk">
      <EmailUnsubscribeForm
        personId={p}
        topic={switchTopic.topic}
        token={t}
        label={switchTopic.label}
        detail={switchTopic.detail}
      />
    </main>
  );
}
