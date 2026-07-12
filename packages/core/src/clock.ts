/**
 * Upholds: core never reads ambient time — determinism for the event-sourced
 * reducer (C-9). Implementations live in the apps; core only receives one.
 */
export interface Clock {
  now(): number;
}
