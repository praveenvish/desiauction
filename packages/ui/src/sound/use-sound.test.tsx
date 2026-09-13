import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  SOUND_STORAGE_KEY,
  readSoundPreference,
  resetSoundPreferenceForTests,
  useSoundPreference,
} from "./use-sound";

describe("useSoundPreference", () => {
  beforeEach(() => {
    // jsdom exposes no working Storage in this setup; a Map-backed stand-in
    // is enough to prove the choice is written and read back.
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
    resetSoundPreferenceForTests();
  });

  it("defaults to off, remembers on, and reads it back", async () => {
    expect(readSoundPreference()).toBe(false);
    const { result } = renderHook(() => useSoundPreference());
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.enabled).toBe(false);
    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe("on");
    // jsdom has no AudioContext, so the browser half stays locked — and the
    // hook must say so rather than pretend.
    expect(result.current.unlocked).toBe(false);
  });

  it("every instance on the page sees the same choice", async () => {
    const a = renderHook(() => useSoundPreference());
    const b = renderHook(() => useSoundPreference());
    await act(async () => {
      await a.result.current.setEnabled(true);
    });
    expect(b.result.current.enabled).toBe(true);
  });

  it("follows the choice made in another tab", async () => {
    const { result } = renderHook(() => useSoundPreference());
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: SOUND_STORAGE_KEY, newValue: "on" }));
    });
    expect(result.current.enabled).toBe(true);
  });
});
