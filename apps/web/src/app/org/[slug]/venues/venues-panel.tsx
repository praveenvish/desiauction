"use client";

import { GROUND_SURFACES } from "@desiauction/core";
import { Badge, Button, Card, Field, Select, useToast, VisuallyHidden } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  createGroundAction,
  createVenueAction,
  setGroundStatusAction,
  type VenuesView,
} from "../../../../server/competition/fixture-actions";

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
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

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
      {venues.length === 0 ? (
        <Card>
          <p className="competitions-hint" data-testid="venues-empty">
            No venues yet. A venue holds one or more grounds; fixtures are scheduled onto grounds.
          </p>
        </Card>
      ) : (
        venues.map((venue) => (
          <Card key={venue.id} data-testid={`venue-${venue.id}`}>
            <div className="competition-head">
              <h2 data-testid="venue-name">{venue.name}</h2>
              <span className="competitions-hint">
                {[venue.address, venue.city].filter((v) => v !== null && v !== "").join(", ")}
              </span>
            </div>
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
                      <tr key={ground.id} data-testid={`ground-${ground.id}`}>
                        <td>{ground.name}</td>
                        <td>{ground.surface}</td>
                        <td>{ground.capacity ?? "—"}</td>
                        <td>{ground.floodlights ? "yes" : "no"}</td>
                        <td>{ground.indoor ? "indoor" : "outdoor"}</td>
                        <td>
                          <Badge tone={ground.status === "active" ? "success" : "warning"}>
                            {ground.status}
                          </Badge>
                        </td>
                        {canManage ? (
                          <td>
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
                    placeholder="Main Oval"
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
                      placeholder="500"
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
          </Card>
        ))
      )}

      {canManage ? (
        <Card data-testid="create-venue-panel">
          <h2>Create a venue</h2>
          <div className="create-competition">
            <Field
              label="Venue name"
              name="venueName"
              value={venueName}
              onChange={(event) => {
                setVenueName(event.target.value);
              }}
              placeholder="Azad Maidan"
            />
            <div className="date-row">
              <Field
                label="Address"
                name="address"
                value={venueAddress}
                onChange={(event) => {
                  setVenueAddress(event.target.value);
                }}
                placeholder="Mahapalika Marg"
              />
              <Field
                label="City"
                name="city"
                value={venueCity}
                onChange={(event) => {
                  setVenueCity(event.target.value);
                }}
                placeholder="Mumbai"
              />
            </div>
            <Button
              onClick={() => void addVenue()}
              loading={busy}
              disabled={venueName.trim().length < 3}
              data-testid="add-venue"
            >
              Create venue
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
