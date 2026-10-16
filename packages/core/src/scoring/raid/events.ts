import type { MatchEvent } from "../types";
import type { RaidEventPayloads } from "./payloads";
export type { RaidEventPayloads, Side } from "./payloads";
export type TypedRaidEvent = {
  [T in keyof RaidEventPayloads]: MatchEvent<T, RaidEventPayloads[T]>;
}[keyof RaidEventPayloads];
