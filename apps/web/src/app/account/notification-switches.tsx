"use client";

import { useAnnouncer } from "@desiauction/ui";
import { useState, useTransition } from "react";

import {
  WHATSAPP_LANGUAGE_LABELS,
  WHATSAPP_LANGUAGES,
  type WhatsAppLanguage,
} from "../../lib/whatsapp-consent";
import {
  setMessageLanguageAction,
  setNotificationPreferenceAction,
  setWhatsappPreferenceAction,
  type NotificationSettings,
} from "../../server/messaging/actions";

/**
 * The switches the Notifications card used to say it could not offer.
 *
 * That card said, honestly, that stopping registration SMS was handled "by a
 * person, not a switch — we would rather tell you that than show you a toggle
 * that does nothing". The toggle now does something: `maySend` reads these
 * rows before every send, so switching one off stops the message rather than
 * recording a preference nobody consults.
 *
 * Sign-in codes are deliberately absent from this list. They never pass the
 * preference gate, because someone who switches off "SMS" and then cannot log
 * in has been handed a worse outcome than the one they were avoiding — and a
 * switch that silently exempts itself would be the dishonest version of that.
 */
export function NotificationSwitches({ settings }: { settings: NotificationSettings }) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(
    () => new Map(settings.topics.map((entry) => [entry.topic, entry.allowed])),
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (topic: string, label: string, next: boolean) => {
    // Optimistic, then reconciled. A switch that waits on a round-trip before
    // moving reads as broken on a slow connection, which is most of them here.
    setState((current) => new Map(current).set(topic, next));
    setError(null);
    startTransition(async () => {
      const result = await setNotificationPreferenceAction(topic, next);
      if (result.ok) {
        announce(next ? `${label} turned on` : `${label} turned off`, "polite");
        return;
      }
      setState((current) => new Map(current).set(topic, !next));
      setError(result.error ?? "That did not save. Try again.");
    });
  };

  return (
    <div className="notify-switches" data-testid="notification-switches">
      {settings.topics.map((entry) => {
        const on = state.get(entry.topic) ?? entry.allowed;
        return (
          <label key={entry.topic} className="notify-switch" htmlFor={`notify-${entry.topic}`}>
            <input
              id={`notify-${entry.topic}`}
              type="checkbox"
              checked={on}
              disabled={pending}
              data-testid={`notify-${entry.topic}`}
              onChange={(event) => {
                toggle(entry.topic, entry.label, event.target.checked);
              }}
            />
            <span className="notify-switch-text">
              <span className="notify-switch-label">{entry.label}</span>
              <span className="notify-switch-detail">{entry.detail}</span>
            </span>
          </label>
        );
      })}
      {error !== null ? (
        <p role="alert" className="notify-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * WhatsApp updates: the one switch that is a CONSENT rather than a preference —
 * so it starts off, and turning it on is recorded with the words shown.
 * Stopping a topic above still stops it here too.
 *
 * The language it comes in is no longer chosen here: it is the person's ONE
 * language (`MessageLanguageChoice` below), which their email follows too. The
 * consent record still names the language current when they said yes — what
 * they agreed to receive, in the words they would receive it.
 */
export function WhatsAppSwitch({
  optedIn,
  label,
  language,
}: {
  optedIn: boolean;
  label: string;
  language: WhatsAppLanguage;
}) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(optedIn);
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setOn(next);
    setError(null);
    startTransition(async () => {
      const result = await setWhatsappPreferenceAction(next, language);
      if (result.ok) {
        announce(next ? "WhatsApp updates turned on" : "WhatsApp updates turned off", "polite");
        return;
      }
      setOn(!next);
      setError(result.error ?? "That did not save. Try again.");
    });
  };

  return (
    // `#whatsapp` is where the email nudge ("Get these on WhatsApp — turn it
    // on in your account") lands, so the switch is the first thing seen.
    <div className="notify-switches" data-testid="whatsapp-switch" id="whatsapp">
      <label className="notify-switch" htmlFor="notify-whatsapp">
        <input
          id="notify-whatsapp"
          type="checkbox"
          checked={on}
          disabled={pending}
          data-testid="notify-whatsapp"
          onChange={(event) => {
            toggle(event.target.checked);
          }}
        />
        <span className="notify-switch-text">
          <span className="notify-switch-label">Updates on WhatsApp</span>
          <span className="notify-switch-detail">{label}</span>
        </span>
      </label>
      {error !== null ? (
        <p role="alert" className="notify-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * LANGUAGE FOR MESSAGES — one choice, for email and WhatsApp alike (founder
 * decision, 2026-09-23). A radio group, not a select: two options, both
 * visible, each named in its own script so a Hindi reader finds हिन्दी without
 * reading English first. Always shown — it decides the email too, which
 * everybody with an address gets, WhatsApp or not.
 *
 * The test ids are the ones the WhatsApp-only radio had, so anything that
 * drove that one drives this.
 */
export function MessageLanguageChoice({ language: initial }: { language: WhatsAppLanguage }) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [language, setLanguage] = useState<WhatsAppLanguage>(initial);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: WhatsAppLanguage) => {
    const previous = language;
    setLanguage(next);
    setError(null);
    startTransition(async () => {
      const result = await setMessageLanguageAction(next);
      if (result.ok) {
        announce(`Messages in ${WHATSAPP_LANGUAGE_LABELS[next].label}`, "polite");
        return;
      }
      setLanguage(previous);
      setError(result.error ?? "That did not save. Try again.");
    });
  };

  return (
    <div className="notify-switches" id="message-language">
      <fieldset className="notify-language" data-testid="whatsapp-language">
        <legend className="notify-language-legend">Language for messages</legend>
        <p className="notify-switch-detail">Emails and WhatsApp messages come in this language.</p>
        <div className="notify-language-options">
          {WHATSAPP_LANGUAGES.map((option) => (
            <label key={option} className="notify-language-option" lang={option}>
              <input
                type="radio"
                name="message-language"
                value={option}
                checked={language === option}
                disabled={pending}
                data-testid={`whatsapp-language-${option}`}
                onChange={() => {
                  choose(option);
                }}
              />
              <span>{WHATSAPP_LANGUAGE_LABELS[option].label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error !== null ? (
        <p role="alert" className="notify-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
