import { ButtonLink, IconMessageCircle, IconSearch, IconTrophy } from "@desiauction/ui";
import Link from "next/link";

import "../components/public/public-kit.css";
import { PageTitleHidden } from "../components/shell/page-title";
import { ThemeReplay } from "../components/shell/theme-replay";
import "./marketing.css";

// PX-2: branded 404 (PX-1 P-07). Copy per the content guide (05 §5).
//
// It used to draw the `mk-` layer's centred band, which paints its own light
// surface — so in the dark theme the one page that says "you are lost" was a
// white slab in an otherwise dark site. It now opens with the kit's band like
// every other public page, and the dead end offers somewhere to go rather than
// two buttons and nothing else.
export default function NotFound() {
  return (
    <main className="content-page">
      {/* Next serves a not-found under its own `<html id="__next_error__">`
          shell, so the root layout's theme bootstrap never runs here — see
          ThemeReplay. */}
      <ThemeReplay />
      {/* A dead end owns its heading: the console shell stands its title down
          rather than framing a page that isn't there. */}
      <PageTitleHidden />
      {/* One centred composition: the numerals, the sentence, the ways out.
          It used to be a band, then a cream body holding three cards in a
          four-column grid (the right quarter empty), with a gavel standing in
          for "search". */}
      <header className="pk-hero pk-soon nf" data-theme="floodlight">
        <div className="pk-soon-inner">
          <p className="nf-code" aria-hidden>
            4<span className="nf-ball" />4
          </p>
          <p className="pk-eyebrow">Lost ball</p>
          <h1 className="pk-hero-title">This page doesn&apos;t exist</h1>
          <p className="pk-hero-lede">
            It may have moved, the link was mistyped — or your account may not have access to it.
          </p>
          <div className="pk-hero-actions pk-soon-actions">
            <ButtonLink href="/home">Go home</ButtonLink>
            <ButtonLink href="/help" variant="secondary">
              Get help
            </ButtonLink>
          </div>
          <nav className="nf-links" aria-label="Other ways in">
            <Link href="/c" className="nf-link">
              <IconTrophy size={20} weight="duotone" /> Browse tournaments
            </Link>
            <Link href="/search" className="nf-link">
              <IconSearch size={20} weight="duotone" /> Search the site
            </Link>
            <Link href="/support" className="nf-link">
              <IconMessageCircle size={20} weight="duotone" /> Contact support
            </Link>
          </nav>
        </div>
      </header>
    </main>
  );
}
