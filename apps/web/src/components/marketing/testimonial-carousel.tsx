"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { IconArrowRight, IconStar } from "./icons";

/**
 * The testimonials carousel (2026-07-18 restructure). Built on native
 * scroll-snap so it degrades perfectly with JS off — the viewport is a real
 * horizontal scroller, swipeable on touch, and on desktop the three cards fit
 * with no overflow so it reads as a static 3-up grid. JS only *enhances*: it
 * adds arrows/dots, tracks the active card, and auto-advances (motion allowed +
 * not hovered/focused). All three quotes stay in the DOM at all times, so a
 * screen reader reads them linearly regardless of scroll position; movement is
 * transform/scroll only, never text opacity.
 *
 * The quotes are the explicitly-approved illustrative testimonials (initials-only
 * avatars) — see marketing.ts.
 */

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}

const AUTOPLAY_MS = 5500;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function TestimonialCarousel({ testimonials }: { testimonials: readonly Testimonial[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const paused = useRef(false);

  const cards = useCallback(
    () => Array.from(viewportRef.current?.querySelectorAll<HTMLElement>("[data-slide]") ?? []),
    [],
  );

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    if (vp === null) {
      return;
    }
    setHasOverflow(vp.scrollWidth - vp.clientWidth > 4);
    const sl = vp.scrollLeft;
    let nearest = 0;
    let best = Infinity;
    cards().forEach((card, i) => {
      const distance = Math.abs(card.offsetLeft - sl);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    setActive(nearest);
  }, [cards]);

  const goTo = useCallback(
    (index: number) => {
      const vp = viewportRef.current;
      const list = cards();
      const target = list[Math.max(0, Math.min(list.length - 1, index))];
      if (vp === null || target === undefined) {
        return;
      }
      vp.scrollTo({
        left: target.offsetLeft,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    },
    [cards],
  );

  // Track scroll position and viewport size.
  useEffect(() => {
    const vp = viewportRef.current;
    if (vp === null) {
      return;
    }
    measure();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(vp);
    return () => {
      cancelAnimationFrame(frame);
      vp.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [measure]);

  // Auto-advance — only when it can scroll, motion is allowed, and it isn't
  // being read (hover/focus pauses it).
  useEffect(() => {
    if (!hasOverflow || reducedMotion()) {
      return;
    }
    const id = window.setInterval(() => {
      if (paused.current) {
        return;
      }
      const list = cards();
      const next = active + 1 >= list.length ? 0 : active + 1;
      goTo(next);
    }, AUTOPLAY_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [hasOverflow, active, cards, goTo]);

  return (
    <div
      className="mk-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label="What organizers say"
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
      onFocusCapture={() => {
        paused.current = true;
      }}
      onBlurCapture={() => {
        paused.current = false;
      }}
    >
      <div className="mk-carousel-viewport" ref={viewportRef}>
        {testimonials.map((testimonial, i) => (
          <figure
            key={testimonial.name}
            className="mk-testi"
            data-slide
            aria-roledescription="slide"
            aria-label={`${String(i + 1)} of ${String(testimonials.length)}`}
          >
            <div className="mk-testi-stars" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, star) => (
                <IconStar key={star} />
              ))}
            </div>
            <blockquote className="mk-testi-quote">“{testimonial.quote}”</blockquote>
            <figcaption className="mk-testi-person">
              <span className="mk-testi-avatar" aria-hidden="true">
                {testimonial.name
                  .split(" ")
                  .map((part) => part.charAt(0))
                  .join("")}
              </span>
              <span>
                <span className="mk-testi-name">{testimonial.name}</span>
                <span className="mk-testi-role">{testimonial.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {hasOverflow ? (
        <div className="mk-carousel-controls">
          <button
            type="button"
            className="mk-carousel-arrow"
            aria-label="Previous testimonial"
            disabled={active === 0}
            onClick={() => {
              goTo(active - 1);
            }}
          >
            <IconArrowRight />
          </button>
          <div className="mk-carousel-dots" role="tablist" aria-label="Choose testimonial">
            {testimonials.map((testimonial, i) => (
              <button
                key={testimonial.name}
                type="button"
                role="tab"
                className="mk-carousel-dot"
                aria-label={`Show testimonial ${String(i + 1)}`}
                aria-selected={active === i}
                data-active={active === i}
                onClick={() => {
                  goTo(i);
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className="mk-carousel-arrow"
            aria-label="Next testimonial"
            disabled={active >= testimonials.length - 1}
            onClick={() => {
              goTo(active + 1);
            }}
          >
            <IconArrowRight />
          </button>
        </div>
      ) : null}
    </div>
  );
}
