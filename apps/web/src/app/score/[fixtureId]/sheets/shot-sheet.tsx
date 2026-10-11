import { useEffect } from "react";
import { Button, Dialog } from "@desiauction/ui";
import {
  BATTING_HANDS,
  zoneAngle,
  type BattingHand,
  type ZoneKey,
} from "@desiauction/core/scoring";
import { Field } from "./field";
import { strings } from "../strings";
export function ShotSheet({
  hand,
  name,
  language,
  onClose,
  onShot,
}: {
  hand: BattingHand;
  name: string;
  language: "en" | "hi";
  onClose: () => void;
  onShot: (shot: { zone: ZoneKey; angle: number }) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [onClose]);
  return (
    <Dialog
      data-testid="shot-sheet"
      open
      onClose={onClose}
      title={strings[language].whereDidItGo}
      footer={
        <Button data-testid="shot-skip" variant="ghost" onClick={onClose}>
          Skip
        </Button>
      }
    >
      <p>
        {hand === BATTING_HANDS[1]
          ? language === "hi"
            ? `${name} बाएँ हाथ से बल्लेबाज़ी करते हैं, इसलिए मैदान आपके लिए उलटा दिखाया गया है`
            : `${name} bats left-handed, so the field is flipped for you`
          : name}
      </p>
      <Field
        hand={hand}
        language={language}
        onZone={(zone) => {
          onShot({ zone, angle: zoneAngle(zone, hand) });
        }}
      />
      <div className="shot-countdown" aria-hidden="true" />
      <p className="score-cap">Closes after five seconds</p>
    </Dialog>
  );
}
