import type { MatchEvent } from "../types";
import type { TimedEventPayloads } from "./payloads";
export type { TimedEventPayloads, Side } from "./payloads";
export type TypedTimedEvent = {
  [T in keyof TimedEventPayloads]: MatchEvent<T, TimedEventPayloads[T]>;
}[keyof TimedEventPayloads];
