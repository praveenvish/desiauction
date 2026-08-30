/**
 * Product telemetry abstraction (PX-3). Product events ONLY — no analytics
 * provider, no network, no PII beyond what the event name itself states.
 * A provider lands post-beta by implementing TelemetrySink and calling
 * setTelemetrySink at app start; nothing else changes.
 *
 * Event semantics: `auth.otp_verify_submitted` fires before verification and
 * `auth.otp_failed` on rejection — successful verification is the difference
 * (the success path navigates away before client code can observe it).
 */

export type ProductEventName =
  | "auth.login_started"
  | "auth.otp_requested"
  | "auth.otp_resent"
  | "auth.otp_verify_submitted"
  | "auth.otp_failed"
  | "auth.logout"
  | "profile.completed"
  | "profile.updated"
  | "onboarding.step_viewed"
  | "onboarding.completed"
  | "org.created"
  | "org.invitation_accepted"
  | "org.switched"
  | "competition.cloned"
  | "register.photo_added"
  | "showcase.player_viewed"
  | "showcase.player_profile_opened"
  | "showcase.exported"
  // DEMO-1. The funnel, one event per step, no PII in any payload: `source`
  // says which CTA sent them and nothing says who they are. Without these the
  // question "is the pricing-page CTA worth anything?" has no answer but a
  // guess, and the question "should the calendar exist at all?" has none either.
  | "demo.form_viewed"
  | "demo.requested"
  | "demo.slot_picked"
  | "demo.confirmed"
  | "demo.cancelled"
  | "demo.rescheduled";

export type TelemetryProps = Record<string, string | number | boolean>;

export interface TelemetryEvent {
  name: ProductEventName;
  props: TelemetryProps;
  at: string;
}

export interface TelemetrySink {
  emit(name: ProductEventName, props?: TelemetryProps): void;
}

const BUFFER_LIMIT = 100;

declare global {
  interface Window {
    __daTelemetry?: TelemetryEvent[];
  }
}

/** Default sink: a window-scoped ring buffer — inspectable in devtools and
 * assertable in e2e, with zero transport and zero persistence. */
const bufferSink: TelemetrySink = {
  emit(name, props) {
    if (typeof window === "undefined") {
      return;
    }
    const buffer = (window.__daTelemetry ??= []);
    buffer.push({ name, props: props ?? {}, at: new Date().toISOString() });
    if (buffer.length > BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - BUFFER_LIMIT);
    }
  },
};

let sink: TelemetrySink = bufferSink;

export function setTelemetrySink(next: TelemetrySink): void {
  sink = next;
}

/** Fire-and-forget; a telemetry failure must never break a product flow. */
export function track(name: ProductEventName, props?: TelemetryProps): void {
  try {
    sink.emit(name, props);
  } catch {
    // Swallow by contract.
  }
}
