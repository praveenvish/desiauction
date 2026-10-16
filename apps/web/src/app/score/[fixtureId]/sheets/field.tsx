import {
  BATTING_HANDS,
  zoneAngle,
  zoneOfAngle,
  ZONE_LABELS,
  type BattingHand,
  type ZoneKey,
} from "@desiauction/core/scoring";
export function fieldPoint(x: number, y: number, width: number, height: number) {
  return { x: Math.max(0, Math.min(1, x / width)), y: Math.max(0, Math.min(1, y / height)) };
}
export function fieldZone(x: number, y: number, hand: BattingHand) {
  return zoneOfAngle((Math.atan2(x - 0.5, 0.5 - y) * 180) / Math.PI, hand);
}
export function Field({
  hand = BATTING_HANDS[0],
  language = "en",
  onZone,
  onPin,
  pin,
}: {
  hand?: BattingHand;
  language?: "en" | "hi";
  onZone?: (zone: ZoneKey) => void;
  onPin?: (point: { x: number; y: number }) => void;
  pin?: { x: number; y: number } | null;
}) {
  return (
    <div className="scoring-field">
      <svg viewBox="0 0 300 300" aria-hidden="true">
        <circle cx="150" cy="150" r="142" fill="#112E1F" stroke="#E8EEF9" />
        <circle cx="150" cy="150" r="85" fill="#0E281B" />
        <rect x="143" y="127" width="14" height="46" rx="3" fill="#C9B48A" />
        {pin && <circle cx={pin.x * 300} cy={pin.y * 300} r="6" fill="var(--text-accent)" />}
      </svg>
      {onPin && (
        <button
          data-testid="wicket-pin"
          className="field-pin-target"
          type="button"
          aria-label="Place optional fielding pin"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onPin(
              event.detail === 0
                ? { x: 0.5, y: 0.5 }
                : fieldPoint(
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                    rect.width,
                    rect.height,
                  ),
            );
          }}
        />
      )}
      {onZone &&
        (Object.keys(ZONE_LABELS[language]) as ZoneKey[]).map((zone) => {
          const angle = (zoneAngle(zone, hand) * Math.PI) / 180;
          return (
            <button
              type="button"
              key={zone}
              data-testid={`shot-zone-${zone}`}
              style={{
                left: `${String(50 + Math.sin(angle) * 34)}%`,
                top: `${String(50 - Math.cos(angle) * 34)}%`,
              }}
              onClick={() => {
                onZone(zone);
              }}
            >
              {ZONE_LABELS[language][zone]}
            </button>
          );
        })}
    </div>
  );
}
