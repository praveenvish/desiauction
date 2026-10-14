"use client";
import { useEffect, useState } from "react";
import { Button, Field } from "@desiauction/ui";
import {
  saveSeasonSponsor,
  seasonSponsorSettings,
} from "../../../server/competition/sponsor-actions";
export function SponsorSettings({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [useLogo, setUseLogo] = useState(false);
  const [hasLogo, setHasLogo] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void seasonSponsorSettings(slug)
      .then((value) => {
        if (active && value) {
          setName(value.name);
          setUseLogo(value.usesLogo);
          setHasLogo(value.hasLogo);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setMessage("Sponsor settings are not available.");
      });
    return () => {
      active = false;
    };
  }, [slug]);
  return (
    <fieldset>
      <legend>Stream sponsor</legend>
      <Field
        name="season-sponsor"
        label="Sponsor name"
        value={name}
        disabled={!ready || pending}
        onChange={(event) => {
          setName(event.target.value);
        }}
        help="Shown on the live stream overlay. Leave blank to remove the sponsor."
      />
      <label>
        <input
          type="checkbox"
          checked={useLogo}
          disabled={!ready || !hasLogo || pending}
          onChange={(event) => {
            setUseLogo(event.target.checked);
          }}
        />{" "}
        Use the season logo
      </label>
      <Button
        disabled={!ready}
        loading={pending}
        onClick={() => {
          setPending(true);
          void saveSeasonSponsor(slug, name, useLogo)
            .then((result) => {
              setMessage(
                result.ok ? "Sponsor saved." : (result.error ?? "Could not save sponsor."),
              );
            })
            .catch(() => {
              setMessage("Could not save sponsor.");
            })
            .finally(() => {
              setPending(false);
            });
        }}
      >
        Save sponsor
      </Button>
      <p role="status">{message}</p>
    </fieldset>
  );
}
