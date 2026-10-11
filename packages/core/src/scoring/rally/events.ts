import type { MatchEvent } from "../types";
import type { RallyEventPayloads } from "./payloads";
export type { RallyEventPayloads, Side, RallyEnd } from "./payloads";
export type RallyEventType = keyof RallyEventPayloads;
export type RallyEvent<T extends RallyEventType = RallyEventType> = MatchEvent<
  T,
  RallyEventPayloads[T]
>;
export type TypedRallyEvent = { [T in RallyEventType]: RallyEvent<T> }[RallyEventType];
