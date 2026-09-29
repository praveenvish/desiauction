"use client";

import { GROUND_SURFACES } from "@desiauction/core";
import {
  Button,
  Dialog,
  Field,
  IconKebab,
  IconPin,
  IconPlus,
  Pill,
  PopoverMenu,
  SectionCard,
  Select,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createGroundAction,
  createVenueAction,
  setGroundStatusAction,
  type VenuesView,
} from "../../../../server/competition/fixture-actions";
import { useHydrated } from "../../../../lib/use-hydrated";
import { release } from "../../../../lib/release";

// Venue → Ground management (M-IP3-3). Server actions do all the deciding;
// this panel renders lists and submits intents.
//
// THE REDESIGN (2026-09-27). Grounds were a six-column table that, below
// 1100px, turned into label soup ("Ground Main Ground Surface turf Capacity —
// Lights No lights…"), and the "Add a venue" form sat open under every list.
// Now each venue is a card, each ground one row that says itself in words
// ("Turf · outdoor · no lights"), and adding a venue or a ground opens a
// dialog. A club with no venue yet still gets the form inline — the one thing
// the tab can do.

type Venue = VenuesView["venues"][number];
type Ground = Venue["grounds"][number];

const SURFACE_LABEL: Record<string, string> = {
  turf: "Turf",
  matting: "Matting",
  astroturf: "Astroturf",
  concrete: "Concrete",
  other: "Other surface",
};

function groundMeta(ground: Ground): string {
  return [
    SURFACE_LABEL[ground.surface] ?? ground.surface,
    ground.capacity !== null ? `${String(ground.capacity)} seats` : null,
    ground.indoor ? "indoor" : "outdoor",
    ground.floodlights ? "floodlit" : "no lights",
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function VenuesPanel({
  slug,
  venues,
  canManage,
}: {
  slug: string;
  venues: VenuesView["venues"];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [addingVenue, setAddingVenue] = useState(false);
  const [groundVenue, setGroundVenue] = useState<Venue | null>(null);
  // Hydration marker (M-IP3-2 pattern): handlers are live once this flips.
  const hydrated = useHydrated();

  const grounds = venues.reduce((sum, venue) => sum + venue.grounds.length, 0);

  const toggleGround = async (groundId: string, status: string) => {
    setBusy(true);
    const next = status === "active" ? "unavailable" : "active";
    const result = await release(setGroundStatusAction(slug, groundId, next), () => {
      setBusy(false);
    });
    if (result.ok) {
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update ground.", tone: "danger" });
    }
  };

  return (
    <div
      className="vn-panel"
      data-testid="venues-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      {venues.length === 0 ? (
        canManage ? (
          <SectionCard
            data-testid="create-venue-panel"
            className="vn-create"
            icon={<IconPin />}
            concept="venue"
            size="feature"
            title="Add your first venue"
            description={
              <span data-testid="venues-empty">
                One venue can hold several grounds; each is added once and serves every season.
              </span>
            }
          >
            <VenueForm
              slug={slug}
              inline
              onDone={() => {
                router.refresh();
              }}
            />
          </SectionCard>
        ) : (
          <p className="competitions-hint">This club has no venues yet.</p>
        )
      ) : (
        <>
          <div className="vn-head">
            <div className="vn-head-text">
              <h2>
                {venues.length} {venues.length === 1 ? "venue" : "venues"} · {grounds}{" "}
                {grounds === 1 ? "ground" : "grounds"}
              </h2>
            </div>
            {canManage ? (
              <Button
                onClick={() => {
                  setAddingVenue(true);
                }}
                data-testid="open-add-venue"
              >
                <IconPlus size={16} aria-hidden />
                Add venue
              </Button>
            ) : null}
          </div>

          {venues.map((venue) => (
            <article
              key={venue.id}
              className="vn-card"
              data-testid={`venue-${venue.id}`}
              aria-labelledby={`vn-${venue.id}`}
            >
              <div className="vn-card-top">
                <span className="vn-pin" aria-hidden>
                  <IconPin size={20} />
                </span>
                <div className="vn-card-id">
                  <h3 id={`vn-${venue.id}`} data-testid="venue-name">
                    {venue.name}
                  </h3>
                  {[venue.address, venue.city].some((v) => v !== null && v !== "") ? (
                    <span>
                      {[venue.address, venue.city].filter((v) => v !== null && v !== "").join(", ")}
                    </span>
                  ) : null}
                </div>
              </div>

              {venue.grounds.length === 0 ? (
                <p className="vn-none">No grounds yet — add the first one below.</p>
              ) : (
                <ul className="vn-grounds" data-testid={`grounds-${venue.id}`}>
                  {venue.grounds.map((ground) => (
                    <li key={ground.id} className="vn-ground" data-testid={`ground-${ground.id}`}>
                      <span className="vn-ground-text">
                        <strong>{ground.name}</strong>
                        <span>{groundMeta(ground)}</span>
                      </span>
                      {ground.status === "active" ? (
                        <Pill tone="green" dot>
                          Available
                        </Pill>
                      ) : (
                        <Pill tone="neutral">Unavailable</Pill>
                      )}
                      {canManage ? (
                        <PopoverMenu
                          label={`Actions for ${ground.name}`}
                          trigger={<IconKebab size={18} />}
                          triggerClassName="vn-kebab"
                          items={[
                            {
                              key: "status",
                              label:
                                ground.status === "active" ? "Mark unavailable" : "Mark available",
                              testId: `ground-status-${ground.id}`,
                              onSelect: () => {
                                if (!busy) {
                                  void toggleGround(ground.id, ground.status);
                                }
                              },
                            },
                          ]}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canManage ? (
                <div className="vn-card-foot">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setGroundVenue(venue);
                    }}
                    data-testid={`open-add-ground-${venue.id}`}
                  >
                    <IconPlus size={14} aria-hidden />
                    Add a ground
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </>
      )}

      {/* Rendered only while open: a closed Dialog keeps its form in the DOM,
          and two "Venue name" fields make every label ambiguous. */}
      {addingVenue ? (
        <Dialog
          open
          onClose={() => {
            setAddingVenue(false);
          }}
          title="Add a venue"
        >
          <VenueForm
            slug={slug}
            onDone={() => {
              setAddingVenue(false);
              router.refresh();
            }}
          />
        </Dialog>
      ) : null}

      {groundVenue !== null ? (
        <Dialog
          open
          onClose={() => {
            setGroundVenue(null);
          }}
          title={`Add a ground at ${groundVenue.name}`}
        >
          <GroundForm
            slug={slug}
            venueId={groundVenue.id}
            onCancel={() => {
              setGroundVenue(null);
            }}
            onDone={() => {
              setGroundVenue(null);
              router.refresh();
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

function VenueForm({
  slug,
  inline = false,
  onDone,
}: {
  slug: string;
  inline?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");

  const submit = async () => {
    setBusy(true);
    const result = await release(createVenueAction(slug, name, address, city), () => {
      setBusy(false);
    });
    if (result.ok) {
      setName("");
      setAddress("");
      setCity("");
      onDone();
    } else {
      toast({ title: result.error ?? "Could not create venue.", tone: "danger" });
    }
  };

  return (
    <div className={inline ? "create-competition vn-form" : "vn-dialog-form"}>
      <Field
        label="Venue name"
        name="venueName"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder="e.g. Azad Maidan"
      />
      <div className="date-row">
        <Field
          label="Address"
          name="address"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
          placeholder="e.g. Mahapalika Marg"
        />
        <Field
          label="City"
          name="city"
          value={city}
          onChange={(event) => {
            setCity(event.target.value);
          }}
          placeholder="e.g. Mumbai"
        />
      </div>
      <Button
        onClick={() => void submit()}
        loading={busy}
        size="touch"
        disabled={name.trim().length < 3}
        data-testid="add-venue"
      >
        Create venue
      </Button>
    </div>
  );
}

function GroundForm({
  slug,
  venueId,
  onCancel,
  onDone,
}: {
  slug: string;
  venueId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [surface, setSurface] = useState<string>(GROUND_SURFACES[0] ?? "turf");
  const [capacity, setCapacity] = useState("");
  const [floodlights, setFloodlights] = useState(false);
  const [indoor, setIndoor] = useState(false);

  const submit = async () => {
    setBusy(true);
    const seats = Number.parseInt(capacity, 10);
    const result = await release(
      createGroundAction(slug, venueId, {
        name,
        surface,
        ...(Number.isFinite(seats) && seats > 0 ? { capacity: seats } : {}),
        floodlights,
        indoor,
      }),
      () => {
        setBusy(false);
      },
    );
    if (result.ok) {
      onDone();
    } else {
      toast({ title: result.error ?? "Could not create ground.", tone: "danger" });
    }
  };

  return (
    <div className="vn-dialog-form">
      <Field
        label="Ground name"
        name="groundName"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder="e.g. Main Oval"
      />
      <div className="date-row">
        <Select
          label="Surface"
          name="surface"
          value={surface}
          onChange={(event) => {
            setSurface(event.target.value);
          }}
        >
          {GROUND_SURFACES.map((entry) => (
            <option key={entry} value={entry}>
              {SURFACE_LABEL[entry] ?? entry}
            </option>
          ))}
        </Select>
        <Field
          label="Capacity"
          name="capacity"
          inputMode="numeric"
          value={capacity}
          onChange={(event) => {
            setCapacity(event.target.value);
          }}
          placeholder="e.g. 500"
        />
      </div>
      <div className="date-row">
        <label className="check-row">
          <input
            type="checkbox"
            checked={floodlights}
            onChange={(event) => {
              setFloodlights(event.target.checked);
            }}
          />
          Floodlights
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={indoor}
            onChange={(event) => {
              setIndoor(event.target.checked);
            }}
          />
          Indoor
        </label>
      </div>
      <div className="date-row">
        <Button
          onClick={() => void submit()}
          loading={busy}
          disabled={name.trim().length < 3}
          data-testid="add-ground"
        >
          Add ground
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
