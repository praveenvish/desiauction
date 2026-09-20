import { ButtonLink, IconGavel, IconHelp, IconTrophy } from "@desiauction/ui";

import { PageBody, PageHero, TopicCard, TopicGrid } from "../components/public/public-kit";
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
      <PageHero
        size="compact"
        eyebrow="Lost ball"
        title="This page doesn't exist"
        lede="It may have moved, the link was mistyped — or your account may not have access to it."
        actions={
          <>
            <ButtonLink href="/home">Go home</ButtonLink>
            <ButtonLink href="/help" variant="secondary">
              Get help
            </ButtonLink>
          </>
        }
      />
      <PageBody>
        <TopicGrid>
          <TopicCard
            href="/c"
            icon={<IconTrophy width={20} height={20} />}
            title="Browse tournaments"
            description="Every tournament published on DesiAuction, open to anyone."
          />
          <TopicCard
            href="/help"
            tone="blue"
            icon={<IconHelp width={20} height={20} />}
            title="Help centre"
            description="Guides for organizers, players and team owners."
          />
          <TopicCard
            href="/search"
            tone="neutral"
            icon={<IconGavel width={20} height={20} />}
            title="Search the site"
            description="Find a help article, a legal document or a page by name."
          />
        </TopicGrid>
      </PageBody>
    </main>
  );
}
