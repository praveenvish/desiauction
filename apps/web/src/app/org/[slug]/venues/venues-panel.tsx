"use client";

import { GROUND_SURFACES } from "@desiauction/core";
import {
  Badge,
  Button,
  Field,
  IconPin,
  SectionCard,
  Select,
  useToast,
  VisuallyHidden,
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

// Venue → Ground management (M-IP3-3). Server actions do all the deciding;
// this panel renders lists and submits intents.

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
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [groundVenue, setGroundVenue] = useState<string | null>(null);
  const [groundName, setGroundName] = useState("");
  const [groundSurface, setGroundSurface] = useState<string>(GROUND_SURFACES[0] ?? "turf");
  const [groundCapacity, setGroundCapacity] = useState("");
  const [floodlights, setFloodlights] = useState(false);
  const [indoor, setIndoor] = useState(false);
  // Hydration marker (M-IP3-2 pattern): handlers are live once this flips.
  const hydrated = useHydrated();

  const addVenue = async () => {
    setBusy(true);
    const result = await createVenueAction(slug, venueName, venueAddress, venueCity);
    setBusy(false);
    if (result.ok) {
      setVenueName("");
      setVenueAddress("");
      setVenueCity("");
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not create venue.", tone: "danger" });
    }
  };

  const addGround = async (venueId: string) => {
    setBusy(true);
    const capacity = Number.parseInt(groundCapacity, 10);
    const result = await createGroundAction(slug, venueId, {
      name: groundName,
      surface: groundSurface,
      ...(Number.isFinite(capacity) && capacity > 0 ? { capacity } : {}),
      floodlights,
      indoor,
    });
    setBusy(false);
    if (result.ok) {
      setGroundName("");
      setGroundCapacity("");
      setFloodlights(false);
      setIndoor(false);
      setGroundVenue(null);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not create ground.", tone: "danger" });
    }
  };

  const toggleGround = async (groundId: string, status: string) => {
    setBusy(true);
    const next = status === "active" ? "unavailable" : "active";
    const result = await setGroundStatusAction(slug, groundId, next);
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update ground.", tone: "danger" });
    }
  };

  return (
    <div
      className="competitions-stack"
      data-testid="venues-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      {venues.length === 0
        ? null
        : venues.map((venue) => (
            <SectionCard
              key={venue.id}
              data-testid={`venue-${venue.id}`}
              className="vn-card"
              icon={<IconPin />}
              concept="venue"
              title={<span data-testid="venue-name">{venue.name}</span>}
              description={
                [venue.address, venue.city].filter((v) => v !== null && v !== "").join(", ") ||
                undefined
              }
              action={
                <span className="vn-count">
                  {venue.grounds.length} ground{venue.grounds.length === 1 ? "" : "s"}
                </span>
              }
            >
              {venue.grounds.length === 0 ? (
                <p className="competitions-hint">No grounds yet.</p>
              ) : (
                <div className="table-scroll">
                  <table className="reg-table" data-testid={`grounds-${venue.id}`}>
                    <thead>
                      <tr>
                        <th>Ground</th>
                        <th>Surface</th>
                        <th>Capacity</th>
                        <th>Lights</th>
                        <th>Indoor</th>
                        <th>Status</th>
                        {canManage ? (
                          <th>
                            <VisuallyHidden>Actions</VisuallyHidden>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {venue.grounds.map((ground) => (
                        /* Every cell carries its heading. `.reg-table` becomes
                         `display: block` with `thead { display: none }` below
                         1100px (seasons.css), and the headings return only
                         through `td::before { content: attr(data-label) }`.
                         Without them this table reads, on every laptop and
                         phone, as a name, a word, a number, "yes", "outdoor",
                         "active" — six values with no way to tell which is the
                         capacity and which is the surface. Screen 21 found the
                         same omission on six administration tables; auditing
                         every `.reg-table` in the product turned up five more
                         files with none at all, all fixed together. */
                        <tr key={ground.id} data-testid={`ground-${ground.id}`}>
                          <td data-label="Ground">{ground.name}</td>
                          <td data-label="Surface">{ground.surface}</td>
                          <td data-label="Capacity">{ground.capacity ?? "—"}</td>
                          {/* "yes" / "no" / "indoor" answered a question the
                            header asked, and at this width the header is gone.
                            Each cell now says what it is on its own. */}
                          <td data-label="Lights">
                            {ground.floodlights ? "Floodlit" : "No lights"}
                          </td>
                          <td data-label="Indoor">{ground.indoor ? "Indoor" : "Outdoor"}</td>
                          <td data-label="Status">
                            <Badge tone={ground.status === "active" ? "success" : "warning"}>
                              {ground.status}
                            </Badge>
                          </td>
                          {canManage ? (
                            <td data-label="">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void toggleGround(ground.id, ground.status)}
                                loading={busy}
                              >
                                {ground.status === "active" ? "Mark unavailable" : "Mark active"}
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canManage ? (
                groundVenue === venue.id ? (
                  <div className="create-competition">
                    <Field
                      label="Ground name"
                      name="groundName"
                      value={groundName}
                      onChange={(event) => {
                        setGroundName(event.target.value);
                      }}
                      placeholder="e.g. Main Oval"
                    />
                    <div className="date-row">
                      <Select
                        label="Surface"
                        name="surface"
                        value={groundSurface}
                        onChange={(event) => {
                          setGroundSurface(event.target.value);
                        }}
                      >
                        {GROUND_SURFACES.map((surface) => (
                          <option key={surface} value={surface}>
                            {surface}
                          </option>
                        ))}
                      </Select>
                      <Field
                        label="Capacity"
                        name="capacity"
                        value={groundCapacity}
                        onChange={(event) => {
                          setGroundCapacity(event.target.value);
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
                        onClick={() => void addGround(venue.id)}
                        loading={busy}
                        disabled={groundName.trim().length < 3}
                        data-testid="add-ground"
                      >
                        Add ground
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setGroundVenue(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setGroundVenue(venue.id);
                    }}
                    data-testid={`open-add-ground-${venue.id}`}
                  >
                    Add a ground
                  </Button>
                )
              ) : null}
            </SectionCard>
          ))}

      {canManage ? (
        <SectionCard
          data-testid="create-venue-panel"
          className="vn-create"
          icon={venues.length === 0 ? <IconPin /> : undefined}
          concept="venue"
          size={venues.length === 0 ? "feature" : "default"}
          title={venues.length === 0 ? "Add your first venue" : "Add a venue"}
          description={
            venues.length === 0 ? (
              <span data-testid="venues-empty">
                One venue can hold several grounds; each is added once and serves every season.
              </span>
            ) : undefined
          }
        >
          <div className="create-competition vn-form">
            <Field
              label="Venue name"
              name="venueName"
              value={venueName}
              onChange={(event) => {
                setVenueName(event.target.value);
              }}
              placeholder="e.g. Azad Maidan"
            />
            <div className="date-row">
              <Field
                label="Address"
                name="address"
                value={venueAddress}
                onChange={(event) => {
                  setVenueAddress(event.target.value);
                }}
                placeholder="e.g. Mahapalika Marg"
              />
              <Field
                label="City"
                name="city"
                value={venueCity}
                onChange={(event) => {
                  setVenueCity(event.target.value);
                }}
                placeholder="e.g. Mumbai"
              />
            </div>
            <Button
              onClick={() => void addVenue()}
              loading={busy}
              // Neutral until there is a name: the primitive's disabled primary.
              size="touch"
              disabled={venueName.trim().length < 3}
              data-testid="add-venue"
            >
              Create venue
            </Button>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
