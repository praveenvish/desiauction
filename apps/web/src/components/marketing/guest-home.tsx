"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowRight, IconCheck, IconGavel, IconRefresh, IconTrophy } from "./icons";
import { track } from "../../lib/telemetry";
import styles from "../../app/guest-home.module.css";

/** Content remains visible before hydration and when motion is disabled. */
export function HomeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  // One delegated listener, so the server-rendered CTAs stay server-rendered:
  // any link carrying data-track="source:target" reports its click.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLElement>("[data-track]");
      const [source = "", target = ""] = (link?.dataset.track ?? "").split(":");
      if (link) track("landing.cta_clicked", { source, target });
    };
    node.addEventListener("click", onClick);
    return () => {
      node.removeEventListener("click", onClick);
    };
  }, []);
  /*
   * SCROLL REVEAL. The waiting pose (24px lower) only applies once this runs
   * — `data-motion="ready"` on the root — so the server-rendered page is
   * complete and still before hydration, with JS off, and under reduced
   * motion. Siblings get an index so a row of cards arrives as a wave, not a
   * block. Transform only: no blur, no opacity (axe samples contrast
   * mid-animation, and a pose that never resolves must still be readable).
   */
  useEffect(() => {
    const node = root.current;
    if (
      !node ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    )
      return;
    /*
     * FAIL OPEN. Only what is BELOW the fold at load ever waits, and the
     * waiting pose is transform-only (24px lower) — never blurred, never
     * transparent. Anything already on screen is simply shown. So a render
     * that never scrolls (a link unfurler, print, a full-page screenshot, a
     * slow device mid-hydration) sees the whole page, sharp.
     */
    const fold = window.innerHeight;
    const targets = Array.from(node.querySelectorAll<HTMLElement>("[data-reveal]")).filter(
      (element) => element.getBoundingClientRect().top > fold,
    );
    for (const element of targets) {
      const siblings = Array.from(element.parentElement?.children ?? []).filter((child) =>
        child.hasAttribute("data-reveal"),
      );
      element.style.setProperty("--reveal-i", String(Math.min(siblings.indexOf(element), 5)));
      element.dataset.reveal = "wait";
    }
    const reveal = (element: Element) => {
      element.setAttribute("data-revealed", "true");
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    node.dataset.motion = "ready";
    targets.forEach((element) => {
      observer.observe(element);
    });
    // Safety nets: printing shows everything; and anything that is in view
    // but somehow was not reported (a missed observer tick, a jump-scroll)
    // settles within 1.5s rather than waiting in its pose.
    const revealAll = () => {
      targets.forEach(reveal);
    };
    const safety = window.setTimeout(() => {
      for (const element of targets) {
        const box = element.getBoundingClientRect();
        if (box.top < window.innerHeight && box.bottom > 0) reveal(element);
      }
    }, 1500);
    window.addEventListener("beforeprint", revealAll);
    return () => {
      window.clearTimeout(safety);
      window.removeEventListener("beforeprint", revealAll);
      observer.disconnect();
      delete node.dataset.motion;
    };
  }, []);
  /*
   * SPOTLIGHT. Cards marked data-spotlight carry a soft gold light that follows
   * the pointer — fine pointers only (a finger has no hover), one delegated
   * listener, one write per frame.
   */
  useEffect(() => {
    const node = root.current;
    if (
      !node ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const card = (last?.target as Element | null)?.closest<HTMLElement>("[data-spotlight]");
      if (!card || !last) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${String(Math.round(last.clientX - box.left))}px`);
      card.style.setProperty("--my", `${String(Math.round(last.clientY - box.top))}px`);
    };
    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    node.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <div ref={root}>{children}</div>;
}

type SportOption = { key: string; label: string; role: string };
const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;

/**
 * THE DEMO NEEDS A RIVAL.
 *
 * It used to hand the visitor both paddles: every click bid for whichever team
 * was not leading, so there was nobody to beat and the SOLD landed on a team the
 * visitor never chose. Now the visitor owns Falcons and Voyagers bid back on
 * their own, which is the one feeling a live auction sells.
 *
 * Phases: 0 opening · 1/3/5 Falcons lead (the visitor's three bids) · 2/4
 * Voyagers counter · 5 also runs the gavel · 6 SOLD. The waits are pauses, not
 * motion, so they stay under reduced motion.
 */
const OPENING = 20000;
const STEP = 5000;
const RIVAL_MS = 1100;
const GAVEL_MS = 800;
const SOLD_PHASE = 6;

/**
 * Shows the header CTA's job on phones, where the header folds "Start free"
 * into the menu: once the hero has scrolled away there was no visible way to
 * sign up for seven screens. Hidden again at the closing CTA so it never
 * doubles it or sits over the footer.
 */
export function StickyCta({ href, label }: { href: string; label: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const hero = document.getElementById("hero");
    const finale = document.getElementById("final-cta");
    if (!hero || !finale) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const pastHero = hero.getBoundingClientRect().bottom < 0;
      const beforeFinale = finale.getBoundingClientRect().top > window.innerHeight;
      setVisible(pastHero && beforeFinale);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div className={styles.stickyCta} data-visible={visible}>
      <Link
        className={styles.primary}
        href={href}
        tabIndex={visible ? undefined : -1}
        data-track="sticky:signup"
      >
        {label} <IconArrowRight size={20} />
      </Link>
    </div>
  );
}

export function AuctionLab({
  sports,
  signupHref,
  signupLabel,
}: {
  sports: SportOption[];
  signupHref: string;
  signupLabel: string;
}) {
  const [selected, setSelected] = useState("football");
  const [phase, setPhase] = useState(0);
  const [gavel, setGavel] = useState<0 | 1 | 2>(0);
  const sport = sports.find((item) => item.key === selected) ?? sports[0];

  useEffect(() => {
    if (phase === 1 || phase === 3) {
      const timer = window.setTimeout(() => {
        setPhase(phase + 1);
      }, RIVAL_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (phase === 5) {
      const timers = [
        window.setTimeout(() => {
          setGavel(1);
        }, GAVEL_MS),
        window.setTimeout(() => {
          setGavel(2);
        }, GAVEL_MS * 2),
        window.setTimeout(() => {
          setPhase(SOLD_PHASE);
          track("landing.mock_sold", { sport: selected });
        }, GAVEL_MS * 3),
      ];
      return () => {
        timers.forEach((timer) => {
          window.clearTimeout(timer);
        });
      };
    }
    return undefined;
  }, [phase, selected]);

  const reset = () => {
    setPhase(0);
    setGavel(0);
  };
  const sold = phase === SOLD_PHASE;
  const amount = OPENING + Math.min(phase, 5) * STEP;
  const yourTurn = phase === 0 || phase === 2 || phase === 4;
  const falconsLead = phase % 2 === 1 || sold;
  const voyagersLead = phase === 2 || phase === 4;
  const yourBids = Math.min(Math.ceil(phase / 2), 3);
  const status = sold
    ? "Sold to Falcons, your team"
    : phase === 0
      ? "Waiting for the first bid"
      : phase === 5
        ? gavel === 0
          ? "Falcons lead. Any more bids?"
          : gavel === 1
            ? "Going once…"
            : "Going twice…"
        : voyagersLead
          ? "Voyagers bid back. Your move."
          : "Falcons lead. Voyagers are thinking…";
  const waitingLabel =
    phase === 5 ? (gavel === 2 ? "Going twice…" : "Going once…") : "Voyagers are bidding…";

  return (
    <section id="playground" className={styles.playground} aria-labelledby="sports-title">
      <div className={styles.container}>
        <div className={styles.sportsHeading} data-reveal>
          <div>
            <p className={styles.eyebrow}>DIFFERENT GAMES. SAME COMPETITIVE SPIRIT.</p>
            <h2 id="sports-title">From cricket to kabaddi to esports.</h2>
          </div>
          <p>
            <strong>{sports.length} sport formats.</strong>
            <br />
            Pick yours, then run a mock auction.
          </p>
        </div>
        <div
          className={styles.sportsGrid}
          role="group"
          aria-label="Choose a sport for the auction demo"
        >
          {sports.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={selected === item.key}
              onClick={() => {
                setSelected(item.key);
                reset();
              }}
            >
              <SportGlyph sport={item.key} />
              <span>{item.label}</span>
              {selected === item.key && (
                <span className={styles.sportCheck}>
                  <IconCheck size={16} />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.demoLayout}>
          <div className={styles.demoCopy} data-reveal>
            <p className={styles.eyebrow}>
              <IconGavel size={16} /> THE AUCTION EXPERIENCE
            </p>
            <h2>
              Bid against a rival owner.
              <br />
              <span>Win the player.</span>
            </h2>
            <p>
              You own Falcons. Voyagers want the same player, and they bid back. Outbid them three
              times and the gavel falls your way.
            </p>
            <p>On auction night, owners do this from their phones while the room watches.</p>
            <Link className={styles.textLink} href="/help/conducting-the-auction">
              See how a real auction works <IconArrowRight size={16} />
            </Link>
          </div>
          <div id="demo-auction" className={styles.auctionStage}>
            <div className={styles.auctionBoard}>
              <div className={styles.boardTop}>
                <span>
                  <span className={styles.demoDot} /> INTERACTIVE DEMO
                </span>
                <span>{sport?.label}</span>
              </div>
              <div className={styles.player}>
                <div className={styles.playerAvatar}>
                  <SportGlyph sport={selected} />
                </div>
                <div>
                  <span>PLAYER 007</span>
                  {/* A fictional player: the demo is a sample, not a real person's lot. */}
                  <h3>Aniket Sawant</h3>
                  <p>
                    {sport?.role} <span>·</span> {sport?.label}
                  </p>
                </div>
                <span className={styles.playerNumber} aria-hidden="true">
                  07
                </span>
              </div>
              <div className={styles.bidZone} aria-live="polite" aria-atomic="true">
                <span>{sold ? "WINNING BID" : phase === 0 ? "OPENING PRICE" : "CURRENT BID"}</span>
                <strong key={String(amount)}>{money(amount)}</strong>
                <p>{status}</p>
                {sold && (
                  <span className={styles.soldStamp}>
                    SOLD <IconCheck size={16} />
                  </span>
                )}
              </div>
              <div className={styles.demoTeams}>
                <div data-leading={falconsLead}>
                  <span className={styles.teamBadge}>F</span>
                  <span>
                    Falcons
                    <small>
                      {sold ? "Player signed" : falconsLead ? "Leading · you" : "Your team"}
                    </small>
                  </span>
                  {falconsLead && <IconTrophy size={16} />}
                </div>
                <div data-leading={voyagersLead}>
                  <span className={styles.teamBadge}>V</span>
                  <span>
                    Voyagers<small>{voyagersLead ? "Leading bid" : "Rival owner"}</small>
                  </span>
                  {voyagersLead && <IconTrophy size={16} />}
                </div>
              </div>
              {sold ? (
                <div className={styles.soldActions}>
                  <Link
                    className={styles.bidButton}
                    href={signupHref}
                    data-track="demo_sold:signup"
                  >
                    {signupLabel}
                    <span>
                      Free <IconArrowRight size={16} />
                    </span>
                  </Link>
                  <button type="button" className={styles.againButton} onClick={reset}>
                    <IconRefresh size={16} /> Try again
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.bidButton}
                  aria-disabled={!yourTurn}
                  onClick={() => {
                    if (!yourTurn) return;
                    track("landing.mock_bid_placed", { bid: yourBids + 1, sport: selected });
                    setPhase(phase + 1);
                  }}
                >
                  {yourTurn ? (
                    <>
                      Bid for Falcons
                      <span>
                        {money(amount + STEP)} <IconArrowRight size={16} />
                      </span>
                    </>
                  ) : (
                    waitingLabel
                  )}
                </button>
              )}
              <div className={styles.demoProgress}>
                <div aria-hidden="true">
                  {[1, 2, 3].map((step) => (
                    <i key={step} data-complete={yourBids >= step} />
                  ))}
                </div>
                <span>
                  {sold
                    ? "Your new teammate. Now picture your league."
                    : `${String(yourBids)} of 3 bids`}
                </span>
              </div>
            </div>
            <p className={styles.demoDisclaimer}>Fictional teams. No real bids or payments.</p>
            <noscript>
              <p className={styles.demoDisclaimer}>
                Enable JavaScript to try the interactive auction demo.
              </p>
            </noscript>
          </div>
        </div>
      </div>
    </section>
  );
}

function SportGlyph({ sport }: { sport: string }) {
  let glyph: ReactNode;
  if (sport === "football")
    glyph = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 7 5 4-2 6H9l-2-6 5-4Zm0-4v4m8 0-3 4m0 9-2-3M4 7l3 4m0 9 2-3" />
      </>
    );
  else if (sport === "basketball")
    glyph = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3v18M6 5c8 5 8 9 0 14M18 5c-8 5-8 9 0 14" />
      </>
    );
  else if (sport === "cricket" || sport === "box_cricket")
    glyph = (
      <>
        <path d="m15 3 2 2-5 6m-1-2 4 4-8 8-4-4 8-8Z" />
        <circle cx="19" cy="17" r="2.5" />
        {sport === "box_cricket" && <path d="M3 9V3h6" />}
      </>
    );
  else if (["badminton", "table_tennis", "pickleball"].includes(sport))
    glyph = (
      <>
        <ellipse cx="14" cy="8" rx="5" ry="6" transform="rotate(35 14 8)" />
        <path d="m10 13-7 8m1-4 3 3M11 5l7 6m-8-3 6 5m-5-2 5-7" />
        <circle cx="20" cy="19" r="2" />
      </>
    );
  else if (sport === "volleyball")
    glyph = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 12 8-4m-8 4-1 9m1-9L5 6m5-3c0 4 4 8 9 10M4 9c5 0 9 5 10 11M5 17c2-3 6-4 8-3" />
      </>
    );
  else if (sport === "hockey")
    glyph = (
      <>
        <path d="m17 3-6 15c-1 3-7 4-8 0-1-2 2-3 5-2L14 3m2 17h5" />
        <circle cx="19" cy="17" r="1.5" />
      </>
    );
  else if (sport === "kabaddi")
    glyph = (
      <>
        <circle cx="8" cy="5" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="m3 12 5-4 5 3 4-2 4 4m-14-3 1 5-5 6m5-6 5 4m4-8-1 6 5 4m-5-4-4 4" />
      </>
    );
  else
    glyph = (
      <>
        <path d="M7 7h10c3 0 5 10 3 11-2 1-4-3-5-3H9c-1 0-3 4-5 3C2 17 4 7 7 7Z" />
        <path d="M8 9v5m-2-2h4m5-1h.01m3 2h.01" />
        {sport === "battle_royale" && <path d="m10 4 2-2 2 2" />}
      </>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
