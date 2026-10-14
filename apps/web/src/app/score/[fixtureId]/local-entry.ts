import type { EventType, PayloadOf, RallyEventPayloads } from "@desiauction/core/scoring";
export type LocalEntry = {
  [T in EventType]: { type: T; payload: PayloadOf<T>; targetEventId?: string | null };
}[EventType];

export type RallyLocalEntry = {
  [T in keyof RallyEventPayloads]: {
    type: T;
    payload: RallyEventPayloads[T];
    targetEventId?: string | null;
  };
}[keyof RallyEventPayloads];
export type FamilyLocalEntry = LocalEntry | RallyLocalEntry;
