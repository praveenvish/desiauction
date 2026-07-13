"use client";

import "@desiauction/ui/styles/motion.css";

import { Badge, Button, Card, useAnnouncer, useHoldGate } from "@desiauction/ui";
import { useState } from "react";

// M-IP1-4 demo: the motion grammar and the voice channel. The hold-to-gavel
// button is the F-AX-1 proof: switch your OS to reduced motion — the ring
// stops sweeping but the gate still takes the full 1.5 seconds of real time.

const HOLD_MS = 1500;

function HoldToGavel() {
  const announce = useAnnouncer();
  const [sold, setSold] = useState(0);
  const gate = useHoldGate({
    durationMs: HOLD_MS,
    onConfirm: () => {
      setSold((count) => count + 1);
      announce("Sold. Lot closed.", "assertive");
    },
  });

  return (
    <div className="demo-row">
      <button
        type="button"
        className="hold-button"
        data-testid="hold-gavel"
        data-holding={gate.holding}
        style={{ "--hold-progress": `${String(gate.progress * 360)}deg` } as React.CSSProperties}
        {...gate.bind}
      >
        <span className="hold-ring" aria-hidden />
        {gate.holding ? "Holding…" : "Hold to gavel"}
      </button>
      <Badge tone={sold > 0 ? "success" : "neutral"} data-testid="gavel-count">
        SOLD ×{sold}
      </Badge>
    </div>
  );
}

function AnnouncerDemo() {
  const announce = useAnnouncer();
  return (
    <div className="demo-row">
      <Button
        variant="secondary"
        onClick={() => {
          announce("Bid of ₹4,25,000 placed.");
        }}
      >
        Announce bid (polite)
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          announce("You lead.");
        }}
      >
        Announce lead (polite)
      </Button>
      <Button
        variant="danger"
        onClick={() => {
          announce("Purse limit reached.", "assertive");
        }}
      >
        Announce limit (assertive)
      </Button>
    </div>
  );
}

function EnterExitDemo() {
  const [visible, setVisible] = useState(true);
  const [pulse, setPulse] = useState(0);
  return (
    <div className="demo-row">
      <Button
        variant="secondary"
        onClick={() => {
          setVisible((v) => !v);
        }}
      >
        Toggle enter/exit
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setPulse((p) => p + 1);
        }}
      >
        Emphasis pulse
      </Button>
      <Card
        key={`${String(visible)}-${String(pulse)}`}
        className={visible ? "da-enter" : "da-exit"}
        padding="dense"
      >
        <span className={pulse > 0 ? "da-emphasis" : undefined} style={{ display: "inline-block" }}>
          A new bid lands like this — fast, physical, consistent.
        </span>
      </Card>
    </div>
  );
}

export function MotionDemo() {
  return (
    <section aria-labelledby="motion-h">
      <h2 id="motion-h">Motion and voice — confirmation, never entertainment</h2>

      <h2>Hold-to-gavel — the safety gate is a clock, not an animation</h2>
      <HoldToGavel />
      <p style={{ color: "var(--text-secondary)", maxWidth: "60ch" }}>
        Release early and nothing happens. Turn on reduced motion at the OS level: the sweep
        disappears, the {String(HOLD_MS)}ms of real held time does not (F-AX-1).
      </p>

      <h2>Enter · exit · emphasis</h2>
      <EnterExitDemo />

      <h2>The voice channel — polite queue, assertive interrupts</h2>
      <AnnouncerDemo />
      <p style={{ color: "var(--text-secondary)", maxWidth: "60ch" }}>
        Fire the two polite announcements quickly — a screen reader hears them in order, never
        clobbered. The assertive channel is reserved for money-critical interruptions.
      </p>
    </section>
  );
}
