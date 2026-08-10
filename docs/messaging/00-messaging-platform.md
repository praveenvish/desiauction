# Messaging platform — SMS, email and in-app

**Status:** design, not built. **Author:** CTO review, 2026-08-09.
**Blocking for:** public beta in India.

This is the plan for how DesiAuction sends a message to a human. It covers SMS,
email and in-app, the template model behind them, what an organizer may
configure, and what consent we must hold before we send anything.

---

## 1. Where we actually are

The product has **two notification systems** built to different standards, and
the wrong one is the one that reaches customers.

### 1a. The finops dispatch pipeline — architecturally right, reaches nobody

`packages/financial-operations` models delivery properly. `DeliveryRequest`
carries `templateId`, `templateVersion`, a rendered `body`, a `bodyDigest`, a
`subjectRef`, a `recipientRef` and a `channel` (`ports.ts:82-83`, `:174-175`).
The body is rendered *before* the adapter; the adapter only transports. Every
dispatch is an event-sourced record with retries, a dead-letter queue and an
audit trail.

Everything about that shape is correct and this plan keeps it.

What it lacks is a destination. Two adapters are registered (`deps.ts:62-65`):

- `createInAppAdapter` returns `{ok: true, confirmed}` with **no side effect at
  all** (`adapters.ts:22-33`). Its justification — "delivery IS visibility, the
  dispatch register is the tray a signed-in officer reads" — describes the
  *operator's* tray. The register is `finops.view`-gated, so the customer who
  paid gets a 404.
- `createOutboxAdapter` writes a `.txt` file to a local directory. There is no
  SMTP anywhere in the repository.

`whatsapp` and `org-webhook` exist in the channel type and resolve to `null`,
producing `channel_unconfigured` with a Retry button that will fail identically
for ever.

### 1b. The registration SMS — reaches customers, architecturally wrong

`apps/web/src/server/competition/registration-notify.ts` is a real MSG91
integration with a circuit breaker, and it is what actually texts players on
approve / reject / waitlist / withdraw / restore.

It has no template model. `messageFor()` builds a complete English sentence in
code, and the transport posts it as a **single variable**:

```ts
body: JSON.stringify({
  template_id: this.config.flowId,
  recipients: [{ mobiles: phone.replace(/^\+/, ""), message }],
})
```

**This cannot work in production in India, and that fact drives this entire
plan.** See §2.

### 1c. Consent

`grep -rniE "opt.?out|unsubscribe|STOP to"` across `apps/web/src` and
`packages/` returns **one** incidental hit. There is no opt-in record, no
opt-out, no STOP keyword handling, and no notification preference anywhere in
the product or the schema. `/account` has no notifications section.

We are sending unsolicited transactional SMS to people — many of them minors,
by an explicit product decision — with no consent artefact and no way to stop.

---

## 2. The constraint that decides the architecture: TRAI DLT

Every commercial SMS terminating on an Indian mobile network passes through the
DLT (Distributed Ledger Technology) registry. The operator registers a **sender
ID (header)** and a **content template**, and the template's fixed text is
matched at delivery time. Only declared variable slots may differ.

A template whose entire body is one variable is not registrable. Our current
call passes the whole sentence as `message`, so:

- **Every decision SMS we send today will be rejected or scrubbed in
  production.** The dev inbox hides this completely.
- One `MSG91_TEMPLATE_ID` is shared across five distinct message shapes
  (approve, reject, waitlist, withdraw, restore) *and* with OTP. DLT needs one
  registered template per shape.
- `env.ts`'s own comment already half-knows this: *"MSG91_TEMPLATE_ID must point
  at a TRANSACTIONAL template … an OTP-only template will render the code slot,
  not the message."*

**Consequence: templates are not a nice-to-have abstraction. The regulator
requires a template registry, and our code must render into registered slots
rather than emitting prose.**

Two further DLT facts shape the design:

- **Transactional vs promotional.** Transactional messages (a registration
  decision, an OTP, a receipt) may be sent to numbers on the DND registry.
  Promotional messages may not, and need explicit consent. Misclassifying is how
  a sender ID gets blocked. Our categories must be explicit in the model, not
  implied by which code path calls the sender.
- **Consent is auditable.** Under DLT and the DPDP Act we should be able to show
  when a person agreed, to what, and how they withdrew.

---

## 3. Target architecture

One pipeline. Every message — SMS, email, in-app, later WhatsApp — is a
**dispatch of a versioned template to a resolved recipient over a channel**,
which is exactly the model IP-6 already has. We generalise it out of finops
rather than inventing a second one.

```
  domain event                  (registration approved, receipt issued, lot sold)
        │
        ▼
  notification policy           which template, to whom, on which channels,
        │                       under which consent + category
        ▼
  template registry             id + version + locale + channel  →  fixed text
        │                       with declared slots, and the DLT/provider id
        ▼
  render                        slots filled, body + bodyDigest produced
        │
        ▼
  consent + preference gate     transactional bypasses preference,
        │                       promotional requires opt-in; both check STOP
        ▼
  dispatch record               queued, event-sourced, retryable, audited
        │
        ▼
  channel adapter               msg91 | smtp/ses | in-app | whatsapp | webhook
        │
        ▼
  delivery receipt              provider callback → sent / delivered / failed
```

### 3.1 The template registry

A template is `(id, version, channel, locale)` and carries:

| field | why |
|---|---|
| `id` | stable across versions — `registration.approved` |
| `version` | templates are **immutable once used**; edits create a version |
| `channel` | `sms` \| `email` \| `in-app` \| `whatsapp` |
| `locale` | `en-IN` at launch; `hi-IN` is the first real ask in this market |
| `category` | `transactional` \| `promotional` — decides the consent rule |
| `body` | fixed text with declared slots |
| `slots` | names, types, and **max length** (SMS budgets are tight) |
| `providerTemplateId` | the DLT/MSG91 id this maps to |
| `senderId` | the registered header |
| `approvalState` | `draft` \| `submitted` \| `approved` \| `rejected` |

**Immutability is the load-bearing rule.** A dispatch records
`templateId@version`, so a message sent last March can be reproduced exactly —
the same property the finops document register already relies on, and the same
reason `bodyDigest` exists.

Rendering is pure and testable: `render(template, slots) → { body, digest }`.
No prose is ever built in a code path.

### 3.2 Channel adapters

The `DeliveryPort` shape stays. What changes is that adapters become honest:

- **`sms`** — MSG91 Flow, but posting *named slots* against a registered
  `providerTemplateId`, not one `message` blob. Keeps the existing circuit
  breaker, which is good work.
- **`email`** — a real SMTP/SES adapter. The filesystem outbox stays as the
  development and test adapter, selected by environment, never by accident.
- **`in-app`** — must actually write a person-scoped notification row. Today it
  returns `confirmed` having done nothing. This is what makes `/inbox` real for
  the customer rather than a login log.
- **`whatsapp`** — deliberately unimplemented, but must report
  `channel_unconfigured` *without offering a Retry button that cannot work*.

**No adapter may report `confirmed` for an action it did not take.** Delivery
truth comes from the provider's callback, not from the absence of an exception.

### 3.3 Consent and preferences

| category | rule |
|---|---|
| `transactional` | sent regardless of preference; suppressed only by a global STOP |
| `promotional` | requires a recorded opt-in; suppressed by preference or STOP |

Sign-in OTP is transactional and always sends — that has to be stated in the UI
so "turn off SMS" cannot lock someone out of their account.

Every send checks, in order: **global suppression (STOP) → category → per-topic
preference**. Every suppression is recorded, so "why didn't they get it?" is
answerable.

---

## 4. Data model

Five new tables. All additive; no existing table is modified.

```
message_templates          id, template_key, version, channel, locale, category,
                           body, slots(jsonb), provider_template_id, sender_id,
                           approval_state, created_by, created_at
                           UNIQUE (template_key, version, channel, locale)

notification_preferences   person_id, topic, channel, allowed, updated_at
                           UNIQUE (person_id, topic, channel)

consent_records            person_id, purpose, granted, source, evidence(jsonb),
                           at, ip, user_agent          -- append-only, never updated

suppressions               phone_or_email, scope(global|topic), reason(stop|bounce|
                           complaint|manual), at, source   -- STOP, hard bounces

message_dispatches         id, org_id, person_id, template_key, template_version,
                           channel, recipient_ref, body_digest, category,
                           status, provider_ref, provider_event_ref,
                           failure_code, requested_at, sent_at, settled_at
```

`message_dispatches` deliberately mirrors `finops_dispatches`. **Open question
for the thaw conversation:** whether finops keeps its own dispatch table or
migrates onto this one. My recommendation is that finops keeps its event-sourced
dispatch stream — it is certified, and re-certifying it is expensive — and that
the two share the *template registry* and the *adapters* only. One template
vocabulary, two owners.

Note `requested_at` and `sent_at`: Screen 18 found the finops delivery desk has
**no timestamp at all**, so a delivery stuck seven days looked identical to one
requested a minute ago. Do not repeat that.

---

## 5. What an admin configures

Two audiences, and conflating them is the trap.

### 5.1 Platform admin (us)

Templates are a **platform** artefact, not a tenant one, because the DLT
registration is ours and the sender ID is ours. A club cannot be allowed to edit
the text of a registered template — the message would stop matching and get
scrubbed at the gateway.

Platform admin can: create a template version, submit for DLT approval, record
the returned `provider_template_id`, activate a version, and preview a render
with sample slots. Editing an active template is impossible by construction —
you create the next version.

`/admin` is currently and deliberately **read-only**, with the property proven at
the database and enforced by a source-level test. Template administration is a
write surface, so it does **not** belong there. It belongs in a new
platform-operations area with its own capability (`messaging.manage`) — and the
`admin-is-read-only` rule stays intact.

### 5.2 Organizer (the club)

An organizer configures **whether and when**, never the words:

- which topics their season sends (registration decisions, auction reminders,
  results, receipts),
- the reply-to address and display name on email,
- a short custom line where a template declares an `{org_note}` slot,
- quiet hours, and per-topic channel choice.

That boundary is the whole design: **the platform owns the sentence, the
organizer owns the send.**

### 5.3 The person

On `/account`: what we send, on which channel, per topic, with a real off switch
for everything except sign-in codes — and the reason that exception exists,
stated. Plus STOP handling from the message itself, which is the route most
people will actually use.

---

## 6. Observability

The current in-app adapter is the anti-pattern: it reports success for a message
nobody can read. Required instead:

- **Provider callbacks** for sent / delivered / failed, mapped to dispatch state.
  MSG91 supports delivery reports; SES supports SNS notifications.
- **Bounce and complaint handling** writes a `suppressions` row automatically.
  Continuing to send to a hard bounce is how a sending domain dies.
- **Per-template delivery rates** — a template whose delivery rate falls is
  usually a DLT mismatch, and that is the failure mode we are most exposed to.
- **A queue-age alarm.** Screen 18 found runner health computed as `dead === 0`,
  so a completely dead runner reported HEALTHY while 1,558 jobs sat eleven days
  deep. Message health must be measured by **age of the oldest unsent**, never
  by absence of failures.

---

## 7. Phasing

**Phase 1 — stop being wrong (blocks beta).**
Register five DLT templates for the decision messages plus one OTP template.
Replace the single-blob MSG91 call with slot rendering against a registered
`providerTemplateId`. Split `MSG91_TEMPLATE_ID` into per-shape ids and separate
OTP from decisions. Add `suppressions` + STOP handling and a consent record at
registration. Add the notifications section to `/account`.
*Without this we cannot legally or technically send SMS in India.*

**Phase 2 — make the pipeline real.**
Template registry tables and the pure renderer. A real SMTP/SES adapter. An
in-app adapter that writes a person-scoped row, which is what finally makes a
receipt visible to the customer who paid. Provider callbacks and dispatch
timestamps.

**Phase 3 — configurability.** *Shipped, with one deliberate reduction.*
Organizer topic and channel settings (`org_messaging_settings`, migration 0024,
the Notifications tab). Per-person preferences beyond the global switch
(`notification_preferences`, the switches on `/account`).

Platform template administration shipped as `/admin/messaging` and NOT behind a
new `messaging.manage` capability. The name implied editing, and §9 below
forbids editing template text on any surface — the gateway matches the
registered sentence character for character. Strip the editing and what remains
is observation, which is what `/admin` is for and needs no new grant. A
capability whose only power is reading a table would be governance theatre, and
this platform's capability partition is not decorative.

**Phase 4 — reach.** *Two of four shipped; two are founder externals.*

- **Per-template delivery analytics — shipped.** Derived from the audit rows the
  sender already writes, so the numbers cannot drift from the evidence.
  Suppressed is reported beside failed, never inside it: a suppressed message is
  the gate working, and folding them together sends an operator chasing an
  outage that is not happening.
- **Quiet hours — shipped for promotional, and deliberately not for
  transactional.** TRAI restricts promotional messaging to daytime; refusing is
  the right response there because promotional is by definition not urgent. It
  is the WRONG response for a decision notice: with no deferral queue for
  messages, "quiet hours" would mean the person is never told at all. Deferring
  transactional notices needs a scheduler this product does not have. Building
  one is a real piece of work, not a wrapper, and it is not pretended here.
- **WhatsApp Business templates — BLOCKED on a founder external.** It needs a
  Meta Business account and per-template approval with its own lead time, and
  §8 decision 3 (in or out of beta) is still open. An adapter written against
  templates nobody has submitted would be a shell that reads like a capability.
- **`hi-IN` locale — BLOCKED on the same class of external.** DLT registers
  templates per language, so a Hindi message needs its own registration. The
  template registry already carries `locale`; what is missing is the
  registration, which is a founder action, not an engineering one.

---

## 8. Decisions needed before Phase 1

1. **Who holds the DLT registration** — DesiAuction as the sender for every club,
   or each club registering its own header? Platform-owned is far simpler and is
   what this plan assumes; club-owned sender IDs are a genuine enterprise ask and
   would change §5.
2. **Do we send promotional messages at all?** If never, the consent surface
   shrinks a great deal.
3. **WhatsApp in or out of beta.** It is how this market communicates, and it has
   its own template approval regime with its own lead time.
4. **Email provider** — SES, Postmark or MSG91's own. Affects the callback shape.
5. **Minors.** Registration is open to all ages by decision. Whether a guardian
   is notified, or a minor's number is messaged at all, is unresolved and
   interacts directly with the consent model.

---

## 9. What this plan deliberately does not do

- It does not let organizers edit message text. That breaks DLT matching, and
  the platform carries the regulatory risk.
- It does not build a WYSIWYG email designer. Slot-filled templates with a
  preview are enough for every message this product sends.
- It does not migrate finops dispatches onto the new table. That is a frozen,
  certified module; it shares templates and adapters and keeps its own stream.
- It does not add a second in-app notification store. `/inbox` reads the
  person-scoped ledger today and should keep doing so — the fix is that the
  in-app adapter must actually write to it.
