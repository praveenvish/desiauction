import { useState } from "react";
import {
  parseBowlingStyle,
  bowlingStyleLabel,
  CRICKET_BOWLING_STYLE_KEYS,
} from "@desiauction/core";
import { BATTING_HANDS, type EventPayloads, type NextAction } from "@desiauction/core/scoring";
import { Button, Dialog } from "@desiauction/ui";
import type { SetupPlayer } from "../setup/setup-model";
export function StyleAsk({
  action,
  profile,
  name,
  onSkip,
  onSave,
}: {
  action: Extract<NextAction, { kind: "ask_style" }>;
  profile?: SetupPlayer | undefined;
  name: string;
  onSkip: () => void;
  onSave: (payload: EventPayloads["style_set"]) => void;
}) {
  const knownBowling = parseBowlingStyle(profile?.bowlingStyle ?? "");
  const [arm, setArm] = useState<(typeof BATTING_HANDS)[number]>(
    action.what === "battingHand"
      ? (profile?.battingHand ?? BATTING_HANDS[0])
      : knownBowling?.startsWith(BATTING_HANDS[1])
        ? BATTING_HANDS[1]
        : BATTING_HANDS[0],
  );
  const [style, setStyle] = useState<(typeof CRICKET_BOWLING_STYLE_KEYS)[number]>(
    knownBowling ?? CRICKET_BOWLING_STYLE_KEYS[0],
  );
  const styles = CRICKET_BOWLING_STYLE_KEYS.filter(
    (key) => key.startsWith(BATTING_HANDS[1]) === (arm === BATTING_HANDS[1]),
  );
  const selectedStyle = styles.includes(style) ? style : styles[0];
  return (
    <Dialog
      data-testid="style-ask"
      open
      onClose={onSkip}
      title={`${name} · ${action.what === "battingHand" ? "Which hand?" : "First over · bowling style"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
          <Button
            onClick={() => {
              if (action.what === "battingHand")
                onSave({ registrationId: action.registrationId, battingHand: arm });
              else if (selectedStyle)
                onSave({ registrationId: action.registrationId, bowlingStyle: selectedStyle });
            }}
          >
            Save style
          </Button>
        </>
      }
    >
      <p>Saved to the player profile when it has no style yet.</p>
      <div className="scoring-sheet-rows">
        {BATTING_HANDS.map((hand) => (
          <Button
            key={hand}
            data-testid={`style-${hand}`}
            variant={arm === hand ? "primary" : "ghost"}
            aria-pressed={arm === hand}
            onClick={() => {
              setArm(hand);
            }}
          >
            {hand === BATTING_HANDS[0] ? "Right" : "Left"}
            {action.what === "bowlingStyle" ? " arm" : " hand"}
          </Button>
        ))}
      </div>
      {action.what === "bowlingStyle" && (
        <div className="scoring-sheet-rows">
          {styles.map((style) => (
            <Button
              key={style}
              data-testid={`style-${style}`}
              variant="ghost"
              aria-pressed={selectedStyle === style}
              onClick={() => {
                setStyle(style);
              }}
            >
              {bowlingStyleLabel(style)}
            </Button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
