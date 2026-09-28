"use client";

import { useAnnouncer } from "@desiauction/ui";
import { useState, useTransition } from "react";

import {
  WHATSAPP_LANGUAGE_LABELS,
  WHATSAPP_LANGUAGES,
  type WhatsAppLanguage,
} from "../../lib/whatsapp-consent";
import type { PersonChannelRow } from "../../server/messaging/catalogue";
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
const CHANNEL_LABEL: Record<PersonChannelRow, string> = {
  email: "Email",
  sms: "WhatsApp / SMS",
  "in-app": "Inbox",
};

type Key = `${string}:${PersonChannelRow}`;

export function NotificationSwitches({ settings }: { settings: NotificationSettings }) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(
    () =>
      new Map<Key, boolean>(
        settings.topics.flatMap((entry) =>
          entry.channels.map((row) => [`${entry.topic}:${row.channel}`, row.allowed]),
        ),
      ),
  );
  const [error, setError] = useState<string | null>(null);

  // ONE SWITCH PER CHANNEL (email programme PR17): "stop the emails about the
  // auction, keep the WhatsApp" is a thing people want, and the gate always
  // read a row per channel — only this screen could not write one.
  const toggle = (topic: string, label: string, channel: PersonChannelRow, next: boolean) => {
    const key: Key = `${topic}:${channel}`;
    // Optimistic, then reconciled. A switch that waits on a round-trip before
    // moving reads as broken on a slow connection, which is most of them here.
    setState((current) => new Map(current).set(key, next));
    setError(null);
    startTransition(async () => {
      const result = await setNotificationPreferenceAction(topic, next, channel);
      if (result.ok) {
        announce(
          `${label} by ${CHANNEL_LABEL[channel].toLowerCase()} turned ${next ? "on" : "off"}`,
          "polite",
        );
        return;
      }
      setState((current) => new Map(current).set(key, !next));
      setError(result.error ?? "That did not save. Try again.");
    });
  };

  return (
    <div className="notify-switches" data-testid="notification-switches">
      {settings.topics.map((entry) => (
        <fieldset key={entry.topic} className="notify-topic" data-testid={`notify-${entry.topic}`}>
          <legend className="notify-switch-text">
            <span className="notify-switch-label">{entry.label}</span>
            <span className="notify-switch-detail">{entry.detail}</span>
          </legend>
          <div className="notify-channels">
            {entry.channels.map((row) => {
              const key: Key = `${entry.topic}:${row.channel}`;
              const on = state.get(key) ?? row.allowed;
              const id = `notify-${entry.topic}-${row.channel}`;
              return (
                <label key={row.channel} className="notify-channel" htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={on}
                    disabled={pending}
                    data-testid={id}
                    aria-label={`${entry.label} by ${CHANNEL_LABEL[row.channel]}`}
                    onChange={(event) => {
                      toggle(entry.topic, entry.label, row.channel, event.target.checked);
                    }}
                  />
                  <span aria-hidden>{CHANNEL_LABEL[row.channel]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
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
