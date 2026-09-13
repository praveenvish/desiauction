"use client";

import { Button, GoldDrift, RollingNumber, SoldStamp } from "@desiauction/ui";
import { useState } from "react";

// PREMIUM-1 theatre on one screen: the digits that roll, the stamp that lands
// and the drift behind it. The gallery's axe pass measures contrast on every
// frame of these, which is the proof that the ceremony never dims a word.

const LADDER = [40_000, 45_000, 55_000, 70_000, 95_000, 1_20_000];

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

export function TheatreDemo() {
  const [rung, setRung] = useState(0);
  const [take, setTake] = useState(0);
  const [tone, setTone] = useState<"sold" | "unsold">("sold");
  return (
    <section aria-labelledby="theatre-h">
      <h2 id="theatre-h">Theatre · RollingNumber · SoldStamp · GoldDrift</h2>
      <div className="demo-row" data-testid="theatre-number">
        <p className="demo-money">
          <RollingNumber value={rupees(LADDER[rung] ?? 0)} data-testid="theatre-amount" />
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setRung((value) => (value + 1) % LADDER.length);
          }}
        >
          Next bid
        </Button>
      </div>
      <div className="demo-row demo-stage" data-testid="theatre-stamp">
        {tone === "sold" ? <GoldDrift count={12} /> : null}
        <SoldStamp key={`${tone}-${String(take)}`} tone={tone} size="lg" />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setTone("sold");
            setTake((value) => value + 1);
          }}
        >
          Replay SOLD
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setTone("unsold");
            setTake((value) => value + 1);
          }}
        >
          Replay UNSOLD
        </Button>
      </div>
    </section>
  );
}
