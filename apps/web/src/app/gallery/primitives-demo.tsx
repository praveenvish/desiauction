"use client";

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  Money,
  Select,
  Skeleton,
  Tabs,
  useToast,
} from "@desiauction/ui";
import { useState } from "react";

// M-IP1-2 demo surface: every primitive, interactive, in both themes.

export function PrimitivesDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const toast = useToast();

  return (
    <section aria-labelledby="primitives-h">
      <h2 id="primitives-h">Primitives — The Eleven</h2>

      <h2>Buttons</h2>
      <div className="demo-row" data-testid="buttons-demo">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button size="sm">Small</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <ButtonLink href="#primitives-h" variant="secondary">
          ButtonLink
        </ButtonLink>
      </div>

      <h2>Badges</h2>
      <div className="demo-row">
        <Badge>Neutral</Badge>
        <Badge tone="success">Paid</Badge>
        <Badge tone="danger">Error</Badge>
        <Badge tone="warning">Expiring</Badge>
        <Badge tone="info">Note</Badge>
        <Badge tone="live">Live</Badge>
      </div>

      <h2>Money</h2>
      <div className="demo-row">
        <Money exact="₹1,10,50,000.00">₹1.1 Cr</Money>
        <Money tone="spent">₹42,00,000</Money>
        <Money tone="remaining">₹68,50,000</Money>
        <Money tone="frozen">₹5,00,000</Money>
        <Money mono exact="₹80,000.00">
          ₹80,000.00
        </Money>
      </div>

      <h2>Form controls</h2>
      <div className="demo-grid">
        <Field label="Team name" placeholder="Malad Mavericks" help="Shown on the Stage." />
        <Field
          label="Owner phone"
          type="tel"
          required
          error="Enter a 10-digit mobile number."
          defaultValue="98765"
        />
        <Select label="Player role" help="Roles come from the tournament setup.">
          <option value="">Choose…</option>
          <option value="bat">Batter</option>
          <option value="bowl">Bowler</option>
          <option value="ar">All-rounder</option>
          <option value="wk">Wicket-keeper</option>
        </Select>
      </div>

      <h2>Card · EmptyState · Skeleton</h2>
      <div className="demo-grid">
        <Card>
          <strong>Sunrisers Malad</strong>
          <p style={{ color: "var(--text-secondary)", margin: "var(--space-2) 0 0" }}>
            14 players · <Money tone="remaining">₹32,00,000</Money> remaining
          </p>
        </Card>
        <Card>
          <EmptyState
            title="No players yet"
            description="Share the registration link to start filling the pool."
            action={<Button size="sm">Share link</Button>}
          />
        </Card>
        <Card aria-hidden>
          <Skeleton width="60%" height="20px" />
          <div style={{ height: "var(--space-2)" }} />
          <Skeleton />
          <div style={{ height: "var(--space-2)" }} />
          <Skeleton width="80%" />
        </Card>
      </div>

      <h2>Tabs</h2>
      <Tabs
        label="Auction sections"
        tabs={[
          { id: "squads", label: "Squads", content: <p>Four squads, sixty-four players.</p> },
          { id: "pool", label: "Pool", content: <p>Twelve players remain in the pool.</p> },
          { id: "purse", label: "Purse", content: <Money tone="remaining">₹1,24,00,000</Money> },
        ]}
      />

      <h2>Dialog · Toast</h2>
      <div className="demo-row">
        <Button
          variant="danger"
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          Remove player…
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast({
              title: "Player saved",
              description: "Rohit S added to the pool.",
              tone: "success",
            });
          }}
        >
          Fire success toast
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast({ title: "Connection lost", description: "Retrying…", tone: "danger" });
          }}
        >
          Fire danger toast
        </Button>
      </div>
      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        title="Remove player?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialogOpen(false);
                toast({ title: "Player removed", tone: "info" });
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p>Rohit S will be removed from the pool. Their registration stays intact.</p>
      </Dialog>
    </section>
  );
}
