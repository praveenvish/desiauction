"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import styles from "./visually-hidden.module.css";

export type AnnounceChannel = "polite" | "assertive";

export interface Announce {
  (message: string, channel?: AnnounceChannel): void;
}

const AnnouncerContext = createContext<Announce | null>(null);

export function useAnnouncer(): Announce {
  const announce = useContext(AnnouncerContext);
  if (announce === null) {
    throw new Error("useAnnouncer requires an <AnnouncerProvider> ancestor");
  }
  return announce;
}

const POLITE_GAP_MS = 150;

/**
 * The C-15 live-region strategy: a polite queue that serializes routine
 * announcements (so rapid events don't clobber each other mid-utterance) and
 * an assertive channel reserved for money-critical interruptions. Regions are
 * permanently mounted — screen readers only track regions present at load.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeText, setPoliteText] = useState("");
  const [assertiveText, setAssertiveText] = useState("");
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const drain = useCallback(() => {
    const next = queue.current.shift();
    if (next === undefined) {
      draining.current = false;
      return;
    }
    draining.current = true;
    // Clear-then-set forces re-announcement of repeated identical messages.
    setPoliteText("");
    timer.current = setTimeout(() => {
      setPoliteText(next);
      timer.current = setTimeout(drain, POLITE_GAP_MS);
    }, POLITE_GAP_MS);
  }, []);

  const announce = useCallback<Announce>(
    (message, channel = "polite") => {
      if (channel === "assertive") {
        setAssertiveText("");
        setAssertiveText(message);
        return;
      }
      queue.current.push(message);
      if (!draining.current) {
        drain();
      }
    },
    [drain],
  );

  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);

  const value = useMemo(() => announce, [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div
        className={styles["hidden"]}
        aria-live="polite"
        role="status"
        data-testid="announcer-polite"
      >
        {politeText}
      </div>
      <div
        className={styles["hidden"]}
        aria-live="assertive"
        role="alert"
        data-testid="announcer-assertive"
      >
        {assertiveText}
      </div>
    </AnnouncerContext.Provider>
  );
}
