"use client";

import { useEffect, useState } from "react";

import styles from "../../../app/home.module.css";

/**
 * THE PHONE'S SWIPE DOTS. Sits under a horizontal rail (any element with the
 * given id) and lights the dot of the card in view. An IntersectionObserver
 * rooted on the rail does the work — nothing runs while the page scrolls, and
 * the rail itself is plain CSS scroll-snap with the phone's own momentum.
 *
 * Only the cards the rail actually shows are counted: on a phone the season
 * track hides its laptop intro, and a dot for an invisible card would never
 * light. Decorative (aria-hidden): the cards are a list a screen reader walks.
 */
export function SwipeDots({ railId, label = "Swipe" }: { railId: string; label?: string }) {
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const rail = document.getElementById(railId);
    if (rail === null || !("IntersectionObserver" in window)) return;
    const cards = Array.from(rail.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.offsetParent !== null,
    );
    // The observer's first report arrives on its own tick with every card,
    // so the count is set there, not synchronously in the effect.
    const observer = new IntersectionObserver(
      (entries) => {
        setCount(cards.length);
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(cards.indexOf(entry.target as HTMLElement));
        }
      },
      { root: rail, threshold: 0.6 },
    );
    cards.forEach((card) => {
      observer.observe(card);
    });
    return () => {
      observer.disconnect();
    };
  }, [railId]);

  if (count < 2) return null;
  return (
    <div className={styles.swipeHint} aria-hidden="true">
      <span className={styles.dots}>
        {Array.from({ length: count }, (_, index) => (
          <i key={index} data-on={index === active ? "" : undefined} />
        ))}
      </span>
      <span>{label} →</span>
    </div>
  );
}

/**
 * THE PHONE'S SEAT TABS. The four seats are one card with four tabs on a
 * phone, not a row of half-hidden cards. The seats stay server-rendered in a
 * list (a laptop shows all four); this only marks which one a phone shows.
 */
export function SeatTabs({ listId, labels }: { listId: string; labels: readonly string[] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    document.getElementById(listId)?.setAttribute("data-active", String(active));
  }, [listId, active]);
  return (
    <div className={styles.seatTabs} role="group" aria-label="Choose a seat">
      {labels.map((label, index) => (
        <button
          key={label}
          type="button"
          aria-pressed={index === active}
          aria-controls={listId}
          onClick={() => {
            setActive(index);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
