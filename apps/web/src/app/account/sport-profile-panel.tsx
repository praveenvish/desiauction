"use client";

import { Button, Card, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { updateSportProfileAction } from "../../server/player/actions";

/**
 * HOW SOMEBODY PLAYS ONE SPORT (SP-1 Phase 3).
 *
 * One of these per sport the platform runs, because the answers are genuinely
 * different in each: a person can be an all-rounder at cricket and a goalkeeper
 * at football, and the single row this replaced could only ever hold one of
 * them.
 *
 * EVERY OPTION IS PASSED IN, none imported. The sport pack knows all of this,
 * but it carries functions — a tiebreaker's `compute`, a score field's `parse`
 * — and a function cannot cross into a client component. So the server hands
 * over plain `{ key, label }` lists and keeps the behaviour on its own side.
 * That constraint is why this file names no sport anywhere in it.
 */
export interface SportFormSpec {
  readonly key: string;
  readonly label: string;
  readonly roleRequired: boolean;
  readonly roles: readonly { readonly key: string; readonly label: string }[];
  readonly attributes: readonly {
    readonly key: string;
    readonly label: string;
    readonly options: readonly { readonly key: string; readonly label: string }[];
  }[];
}

export function SportProfilePanel({
  spec,
  defaultRole,
  attributes,
}: {
  spec: SportFormSpec;
  defaultRole: string | null;
  attributes: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(updateSportProfileAction, {});
  const router = useRouter();
  const toast = useToast();
  const announced = useRef(false);

  useEffect(() => {
    if (state.saved === true && !announced.current) {
      announced.current = true;
      toast({ tone: "success", title: `${spec.label} profile saved` });
      router.refresh();
    }
  }, [state.saved, spec.label, toast, router]);

  const errorFor = (field: string): { error: string } | Record<string, never> =>
    state.error !== undefined && state.field === field ? { error: state.error } : {};

  return (
    <Card>
      <h2>{spec.label}</h2>
      <p className="account-prose">
        How you play {spec.label.toLowerCase()}, remembered once — a registration form for a{" "}
        {spec.label.toLowerCase()} season starts filled in. Every field is optional.
      </p>
      <form action={formAction} className="cricket-profile-form">
        {/* The sport this form is about, so one action serves them all. */}
        <input type="hidden" name="sport" value={spec.key} />
        <div className="cricket-profile-grid">
          {spec.roles.length > 0 ? (
            <Select
              /*
               * Named with its sport. With a panel per sport there are two of
               * these on /account, and "Playing role" twice is ambiguous to
               * anyone reading the page through its accessible names — the
               * heading above disambiguates them visually and nothing did for a
               * screen reader.
               */
              label={`${spec.label} playing role`}
              name="default_role"
              defaultValue={defaultRole ?? ""}
              {...errorFor("default_role")}
            >
              <option value="">Choose…</option>
              {spec.roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </Select>
          ) : null}
          {spec.attributes.map((attribute) => (
            <Select
              key={attribute.key}
              label={attribute.label}
              name={attribute.key}
              defaultValue={attributes[attribute.key] ?? ""}
              {...errorFor(attribute.key)}
            >
              <option value="">Choose…</option>
              {attribute.options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          ))}
        </div>
        {/* A form-level failure has no field to attach to. */}
        {state.error !== undefined && state.field === undefined ? (
          <p role="alert">{state.error}</p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : `Save ${spec.label.toLowerCase()} profile`}
        </Button>
      </form>
    </Card>
  );
}
