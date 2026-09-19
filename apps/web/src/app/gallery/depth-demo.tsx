"use client";

import {
  Button,
  Card,
  IconGavel,
  IconLayers,
  IconTrophy,
  IconUsers,
  Reveal,
  SOUND_CUES,
  Tilt,
  useSoundCue,
  useSoundPreference,
} from "@desiauction/ui";

import { SoundToggle } from "../../components/shell/sound-toggle";

// The foundation of the premium pass, on one screen: the interactive Card
// (the one hover language every console card shares), Tilt (pointer depth,
// fine pointers only), Reveal (scroll entrance, transform only) and the
// synthesised cue set behind the sound switch. Everything here is what a
// product surface gets by using the primitive — nothing is styled locally.

const TILES = [
  { icon: IconUsers, title: "Registrations", body: "12 registered · 10 approved" },
  { icon: IconGavel, title: "Auction night", body: "Nothing at auction yet" },
  { icon: IconTrophy, title: "Settlement", body: "Settled — every rupee placed" },
];

function CueButtons() {
  const play = useSoundCue();
  const sound = useSoundPreference();
  return (
    <div className="demo-row" data-testid="sound-cues">
      <SoundToggle />
      {SOUND_CUES.map((cue) => (
        <Button
          key={cue}
          variant="secondary"
          size="sm"
          disabled={!sound.enabled}
          onClick={() => {
            play(cue);
          }}
        >
          {cue}
        </Button>
      ))}
    </div>
  );
}

export function DepthDemo() {
  return (
    <section aria-labelledby="depth-h">
      <h2 id="depth-h">Depth · Reveal · Sound</h2>

      <h2>Interactive cards (shared hover, active, focus)</h2>
      <div className="demo-grid da-stagger" data-testid="interactive-cards">
        {TILES.map(({ icon: Icon, title, body }) => (
          <Card key={title} interactive tabIndex={0} padding="dense">
            <Icon size={22} />
            <h3>{title}</h3>
            <p>{body}</p>
          </Card>
        ))}
        <Card elevation="flat" padding="dense">
          <h3>Flat, not interactive</h3>
          <p>A decorative container stays still.</p>
        </Card>
      </div>

      <h2>Tilt (fine pointers only; flat on touch and reduced motion)</h2>
      <div className="demo-row">
        <Tilt glare lift data-testid="tilt-card">
          <Card elevation="floating">
            <IconLayers size={22} />
            <h3>Lot 23 · Arjun Pawar</h3>
            <p>Move the pointer across the face.</p>
          </Card>
        </Tilt>
      </div>

      <h2>Reveal (scroll the page; each row arrives in turn)</h2>
      <div className="demo-grid">
        {["First", "Second", "Third"].map((label, index) => (
          <Reveal key={label} index={index}>
            <Card padding="dense">
              <h3>{label}</h3>
              <p>Transform only — never opacity on text.</p>
            </Card>
          </Reveal>
        ))}
      </div>

      <h2>Sound cues (synthesised; unlocked by the switch)</h2>
      <CueButtons />
    </section>
  );
}
