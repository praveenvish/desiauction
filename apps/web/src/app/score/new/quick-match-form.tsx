"use client";
import { Button, ButtonLink } from "@desiauction/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createQuickMatchAction } from "./actions";
export function QuickMatchForm({
  formats,
}: {
  formats: readonly { key: string; label: string; playersPerSide: number }[];
}) {
  const router = useRouter();
  const [homeName, setHomeName] = useState("");
  const [awayName, setAwayName] = useState("");
  const [formatKey, setFormatKey] = useState("t10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setSaving(true);
    setError(null);
    const result = await createQuickMatchAction({
      homeName,
      awayName,
      formatKey,
      sport: formatKey === "box_6" ? "box_cricket" : "cricket",
    });
    if (result.ok) router.push(`/score/${result.fixtureId}/setup`);
    else {
      setError(result.message);
      setSaving(false);
    }
  }
  return (
    <main className="score-home">
      <header className="score-header">
        <ButtonLink href="/score" variant="ghost">
          Back
        </ButtonLink>
        <h1>Quick match</h1>
      </header>
      <form
        className="score-quick-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="score-cap" htmlFor="quick-home">
          Your team
        </label>
        <input
          id="quick-home"
          required
          maxLength={120}
          value={homeName}
          onChange={(event) => {
            setHomeName(event.target.value);
          }}
          autoComplete="off"
        />
        <label className="score-cap" htmlFor="quick-away">
          Opponent
        </label>
        <input
          id="quick-away"
          required
          maxLength={120}
          value={awayName}
          onChange={(event) => {
            setAwayName(event.target.value);
          }}
          autoComplete="off"
        />
        <p>Teams stay in your match space. Pick players on the next screen.</p>
        <fieldset className="score-condition-group">
          <legend className="score-cap">Format and house rules</legend>
          <div className="score-tiles">
            {formats.map((format) => (
              <Button
                key={format.key}
                variant="secondary"
                size="touch"
                aria-pressed={formatKey === format.key}
                onClick={() => {
                  setFormatKey(format.key);
                }}
              >
                {format.label}
              </Button>
            ))}
          </div>
        </fieldset>
        <p>{formats.find((format) => format.key === formatKey)?.playersPerSide} players a side</p>
        <p>
          Who can watch <strong>Anyone with the link</strong>
        </p>
        <p>Your match stays out of public club and tournament listings.</p>
        {error && <p role="alert">{error}</p>}
        <Button
          type="submit"
          size="touch"
          disabled={saving || !homeName.trim() || !awayName.trim()}
        >
          {saving ? "Creating match…" : "Next: pick players"}
        </Button>
      </form>
    </main>
  );
}
