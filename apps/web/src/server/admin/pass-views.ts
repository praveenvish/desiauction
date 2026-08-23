"use server";

import { systemDb } from "../db";
import { platformBillingGate } from "./authz";
import { passQueue, type PassQueue } from "./passes";

/**
 * The read side of the pass queue, gated on the SAME grant as the write.
 *
 * Deliberately `platform:billing` and not `platform:admin`: an open request
 * carries a customer's name, their organizer's phone and what they asked for,
 * which is commercial correspondence rather than platform observation. Somebody
 * who may only observe has no business reading it, and somebody who may answer
 * needs to.
 */
export async function adminPassQueue(): Promise<PassQueue | null> {
  if ((await platformBillingGate()) === null) {
    return null;
  }
  return passQueue(systemDb);
}
