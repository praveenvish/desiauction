"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { SoundCue } from "./cues";
import { createSoundEngine, type SoundEngine } from "./engine";

/**
 * Sound is a device-local choice, like the theme: the same person may want
 * the hall's projector loud and the phone in their pocket silent. It is
 * therefore remembered in this browser only, never on the account.
 */
export const SOUND_STORAGE_KEY = "da-sound";

/** The page-wide engine. Inert until a gesture unlocks it. */
export const soundEngine: SoundEngine = createSoundEngine();

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSoundPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Private mode / storage disabled: the choice still holds for this view.
  }
}

/*
 * ONE STORE FOR THE WHOLE PAGE. The switch in the header and the surface that
 * plays the cues are different components; if each held its own useState the
 * switch would flip and the surface would never hear about it (a `storage`
 * event fires in OTHER tabs only). So the state lives here, at module level,
 * and every hook instance subscribes to the same snapshot.
 */
interface SoundSnapshot {
  enabled: boolean;
  unlocked: boolean;
  ready: boolean;
}

const SERVER_SNAPSHOT: SoundSnapshot = { enabled: false, unlocked: false, ready: false };
let snapshot: SoundSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function publish(next: Partial<SoundSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const stored = readSoundPreference();
  soundEngine.setEnabled(stored);
  publish({ enabled: stored, unlocked: soundEngine.unlocked, ready: true });
  window.addEventListener("storage", (event) => {
    if (event.key !== SOUND_STORAGE_KEY) return;
    const next = event.newValue === "on";
    soundEngine.setEnabled(next);
    publish({ enabled: next });
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // The first subscriber on the client reads the stored choice. Deferred a
  // tick so the server-rendered "off" is what hydrates, exactly as the theme
  // toggle does; the real value follows immediately after.
  if (!hydrated) queueMicrotask(hydrate);
  return () => {
    listeners.delete(listener);
  };
}

export interface SoundPreference {
  /** The person's choice. Off until they turn it on. */
  enabled: boolean;
  /** True once the browser has let audio start (needs a gesture). */
  unlocked: boolean;
  /** False during SSR and until the stored choice has been read. */
  ready: boolean;
  /**
   * Flip the choice. Call it from the click handler itself — turning sound
   * ON is the gesture that unlocks the browser, and that only counts while
   * the event is still on the stack.
   */
  setEnabled: (enabled: boolean) => Promise<void>;
}

/** Test seam: forget the hydrated state so a fresh render starts from storage. */
export function resetSoundPreferenceForTests(): void {
  hydrated = false;
  snapshot = SERVER_SNAPSHOT;
  soundEngine.setEnabled(false);
}

/**
 * The stored choice, shared by every component on the page and kept in sync
 * with the engine and across tabs.
 */
export function useSoundPreference(): SoundPreference {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );

  const setEnabled = useCallback(async (next: boolean) => {
    soundEngine.setEnabled(next);
    writeSoundPreference(next);
    publish({ enabled: next });
    if (next) {
      publish({ unlocked: await soundEngine.unlock() });
    }
  }, []);

  return { ...state, setEnabled };
}

/**
 * A stable `play` for a surface that reacts to events. It is a no-op until
 * the person has both chosen sound and unlocked it, so callers key cues on
 * their moments without checking anything.
 */
export function useSoundCue(): (cue: SoundCue) => void {
  return useCallback((cue: SoundCue) => {
    soundEngine.play(cue);
  }, []);
}
