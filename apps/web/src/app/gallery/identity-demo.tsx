"use client";

import { Money, PlayerCard, PlayerImage } from "@desiauction/ui";

// M-IP1-3 demo: the C-25 identity wall. 20 generated players — Devanagari,
// long names, single names, unknowable names — plus photo/error states and
// the team-color edge. The WI-9 taste check happens on this section.

const WALL: { name: string; seed: string }[] = [
  { name: "Rohit Sharma", seed: "w01" },
  { name: "रोहित शर्मा", seed: "w02" },
  { name: "Smriti Mandhana", seed: "w03" },
  { name: "Jadeja", seed: "w04" },
  { name: "Yashasvi Bhupendra Kumar Jaiswal", seed: "w05" },
  { name: "हरमनप्रीत कौर", seed: "w06" },
  { name: "O'Brien-D'Souza Jr.", seed: "w07" },
  { name: "Arshdeep Singh", seed: "w08" },
  { name: "दीप्ति शर्मा", seed: "w09" },
  { name: "Tilak Varma", seed: "w10" },
  { name: "Priya", seed: "w11" },
  { name: "Mohammed Siraj", seed: "w12" },
  { name: "ऋषभ पंत", seed: "w13" },
  { name: "Kuldeep Yadav", seed: "w14" },
  { name: "Jemimah Rodrigues", seed: "w15" },
  { name: "शुभमन गिल", seed: "w16" },
  { name: "Venkatesh Iyer", seed: "w17" },
  { name: "Renuka Singh Thakur", seed: "w18" },
  { name: "", seed: "w19" },
  { name: "Axar Patel", seed: "w20" },
];

// Local data-URI "photos" — the photo path with zero network dependency.
const PHOTO_A = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2C3A52"/><stop offset="1" stop-color="#48597A"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="80" cy="64" r="30" fill="#9FB0CC"/><rect x="34" y="104" width="92" height="56" rx="28" fill="#9FB0CC"/></svg>',
)}`;
const PHOTO_B = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1F2A3D"/><stop offset="1" stop-color="#6E8F06"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="80" cy="62" r="28" fill="#E8EEF9"/><rect x="36" y="102" width="88" height="58" rx="26" fill="#E8EEF9"/></svg>',
)}`;

export function IdentityDemo() {
  return (
    <section aria-labelledby="identity-h">
      <h2 id="identity-h">Player identity — every player has a face (C-25)</h2>

      <h2>The wall — no photographs, all premium</h2>
      <div className="wall" data-testid="identity-wall">
        {WALL.map(({ name, seed }) => (
          <figure key={seed} className="wall-item">
            <PlayerImage name={name} seed={seed} size="hero" />
            <figcaption>{name === "" ? "— (name pending)" : name}</figcaption>
          </figure>
        ))}
      </div>

      <h2>Photo · loading fallback · failure recovery</h2>
      <div className="demo-row">
        <PlayerImage name="With Photo" seed="ph1" src={PHOTO_A} size="hero" />
        <PlayerImage name="Second Photo" seed="ph2" src={PHOTO_B} size="hero" />
        <PlayerImage name="Broken Source" seed="ph3" src="/definitely-missing.jpg" size="hero" />
      </div>
      <p style={{ color: "var(--text-secondary)" }}>
        The third player&apos;s photo URL is broken on purpose — the mark takes over; nothing ever
        looks unfinished.
      </p>

      <h2>Sizes · shapes · team colors</h2>
      <div className="demo-row">
        <PlayerImage name="Rohit Sharma" seed="w01" size="xs" />
        <PlayerImage name="Rohit Sharma" seed="w01" size="sm" />
        <PlayerImage name="Rohit Sharma" seed="w01" size="md" />
        <PlayerImage name="Rohit Sharma" seed="w01" size="lg" />
        <PlayerImage name="Rohit Sharma" seed="w01" size="xl" shape="round" />
        <PlayerImage name="Rohit Sharma" seed="w01" size="xl" teamColor="#D93843" />
        <PlayerImage name="Rohit Sharma" seed="w01" size="xl" teamColor="#2673D6" />
      </div>

      <h2>Player cards — roster, search, results</h2>
      <div className="card-stack">
        <PlayerCard
          name="Rohit Sharma"
          seed="w01"
          role="batter"
          captain
          status="sold"
          detail="Sunrisers Malad"
          teamColor="#D93843"
          trailing={<Money exact="₹8,25,000.00">₹8.25 L</Money>}
        />
        <PlayerCard
          name="ऋषभ पंत"
          seed="w13"
          role="keeper"
          status="verified"
          detail="Base ₹50,000 · Andheri"
          trailing={<Money tone="spent">₹50,000</Money>}
        />
        <PlayerCard
          name="Yashasvi Bhupendra Kumar Jaiswal"
          seed="w05"
          role="all-rounder"
          status="registered"
          detail="Base ₹25,000"
        />
        <PlayerCard
          name="Kiran Patel"
          seed="w21"
          role="bowler"
          status="passed"
          detail="Eligible for re-entry round"
        />
        <PlayerCard
          name="Second Photo"
          seed="ph2"
          photoSrc={PHOTO_B}
          role="batter"
          status="verified"
          detail="Photo on file"
        />
      </div>
    </section>
  );
}
