# Route publication register

E01 · All141 page entries mapped. This is the inherited source contract, not runtime acceptance. Authority: server/seo/routes.ts, middleware.ts, ancestor/page metadata and each route’s read model. Header and page robots combine restrictively; public access is not indexing permission. Generated metadata/OG and sitemap require eligible public facts; never token/session/private facts. Each implementation package proves actual SSR/poll/socket/chart/overlay/OG surfaces before BUILD-PASS.

| Class | Access/publication | Bound rule |
| --- | --- | --- |
| PUBLIC-CONTENT | Public content allowlist | Registry server/seo/routes.ts plus page metadata/content availability; only listed eligible canonical pages enter sitemap; retain canonical/OG authored content. No private Home data. |
| PUBLIC-SEASON | Public season listing | public competition readers gate visibility/listing; c/[slug]/generateMetadata uses listed for index/follow and canonical. Private/missing is denied. |
| PUBLIC-MATCH | Public fixture live view | server/scoring/public-page.ts publicPage; public visibility, current trust/delay, match-date minors and void/revision gates apply to SSR and every update. Base match index true/follow true; board/overlay noindex/nofollow. Canonical/share only public eligible identity. |
| PUBLIC-PROFILE | Public player/team | Public readers enforce eligibility/minors/privacy. Link-only profile/team noindex; public insights noindex/nofollow and historical attribution availability. No self-only fields in metadata. |
| TOKEN-MATCH | Bearer match share | /m tokenLiveView: token scoped reader, noindex/nofollow header. No token in canonical, parent public URL, OG or analytics. Unknown/withdrawn unavailable; current privacy/delay/trust apply. |
| SELF | Own profile | Session-own person only; /me and insights noindex/nofollow header. Self and public payloads remain separate. |
| OPS | Operational session/capability | Session and current tenant/season/object grants checked by page/readers/actions; noindex/nofollow middleware. Own/manager/scorer/finance/operator do not inherit each other. Canonical/OG must not expose private payloads. |
| PUBLIC-REGISTRATION | Public registration | /seasons/[slug]/register allowlisted with own noindex/follow; registrationLanding eligibility and submit session policy retained; safe public season parent. |
| PUBLIC-BROADCAST | Published auction broadcast | board/overlay use server/auction/conduct-actions.ts publicSpectatorView(slug) ?? spectatorView(slug); public published auction reader, authorised spectator fallback otherwise; noindex/nofollow. Public spectator-safe snapshot only; no conduct commands/private owner plan. |
| PUBLIC-SPECTATE | Public auction audience | Public allowlist exception; season visibility/read model and generated metadata gate access/indexing. No conductor/owner private plan or commands. |
| TOKEN-CONFIRM | Result confirmation | Signed token plus authenticated current eligible opposing manager/current revision; noindex/nofollow. Never turn into public feedback or expose token. |
| TOKEN-FEEDBACK | Feedback request | reviewPageState token gate; unknown404/expired/closed/open distinctions; noindex/nofollow. No ancestor loading that commits200 before unknown gate. Published review separately eligible; token never canonical/analytics. |
| TOKEN-INTENT | Invite/demo/handover/email intent | Existing token validity and session/recipient conditions as applicable; noindex/nofollow middleware. Never broaden bearer authority, preserve safe next/expired state and token redaction. |
| EMBED | Public embed duplicate | Existing public visibility reader; own noindex/follow, header noindex/nofollow remains stricter. Retain framing/CSP and public-only payloads. |
| DEV | Development/gallery | Existing environment/capability gates, noindex/nofollow header. /dev/inbox404 before query outside development. Gallery never a product publication route. |
| BOUNDARY | Catch-all/parallel action | Inherited shell/current route authority; unknown404 and modal/catchall semantics preserved; no invented publication or canonical identity. |
| PUBLIC-UNLISTED | Public but unlisted | login/contact/careers/api-docs and public conversion/unsubscribe/search exceptions retain own metadata; search noindex/nofollow middleware. No sitemap addition without policy review. |

Unchanged unknown/denied/expired states remain unavailable or their existing honest explanation, never fallback private payload. No new canonical URL is invented for operational/token states. Preserve exact redirect and safe parent/return link at runtime. Public-content registries may deliberately have noindex placeholders (case studies etc.); class membership never overrides these.

| Entry | Class | Direct metadata/guard evidence | Runtime owner |
| --- | --- | --- | --- |
| @action/[...missing]/page.tsx | BOUNDARY | Inherited + route reader (see baseline source roots) | Primary implementer / scoped package |
| @action/home/page.tsx | BOUNDARY | currentSession | Primary implementer / scoped package |
| @action/orgs/page.tsx | BOUNDARY | Inherited + route reader (see baseline source roots) | Primary implementer / scoped package |
| @action/seasons/[slug]/teams/page.tsx | BOUNDARY | Inherited + route reader (see baseline source roots) | Primary implementer / scoped package |
| @action/tournaments/page.tsx | BOUNDARY | Inherited + route reader (see baseline source roots) | Primary implementer / scoped package |
| [...missing]/page.tsx | BOUNDARY | notFound | Primary implementer / scoped package |
| about/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| account/page.tsx | OPS | metadata, currentSession, redirect | Primary implementer / scoped package |
| admin/auctions/[auctionId]/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound, notFound | Primary implementer / scoped package |
| admin/audit/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/demos/availability/page.tsx | OPS | metadata, platformDemoGate, notFound | Primary implementer / scoped package |
| admin/demos/page.tsx | OPS | metadata, platformDemoGate, notFound | Primary implementer / scoped package |
| admin/erasure/page.tsx | OPS | metadata, platformPrivacyGate, notFound | Primary implementer / scoped package |
| admin/health/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/live/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/moderation/page.tsx | OPS | metadata, platformModerationGate, notFound, notFound, notFound | Primary implementer / scoped package |
| admin/newsletter/page.tsx | OPS | metadata, platformAdminPageGate, notFound | Primary implementer / scoped package |
| admin/notifications/[kind]/email/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/notifications/analytics/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/notifications/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/notifications/suppressions/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/notifications/templates/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/orgs/[slug]/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound, notFound | Primary implementer / scoped package |
| admin/orgs/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/passes/page.tsx | OPS | metadata, platformBillingGate, notFound, notFound | Primary implementer / scoped package |
| admin/people/[personId]/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound, notFound | Primary implementer / scoped package |
| admin/people/page.tsx | OPS | metadata, platformAdminPageGate, notFound, notFound | Primary implementer / scoped package |
| admin/reports/page.tsx | OPS | metadata, platformSupportGate, notFound | Primary implementer / scoped package |
| admin/reviews/page.tsx | OPS | metadata, platformSupportGate, notFound | Primary implementer / scoped package |
| admin/roles/page.tsx | OPS | metadata, platformGrantPageGate, notFound, notFound | Primary implementer / scoped package |
| api-docs/page.tsx | PUBLIC-UNLISTED | metadata | Primary implementer / scoped package |
| auctions/page.tsx | OPS | metadata, currentSession | Primary implementer / scoped package |
| c/(directory)/page.tsx | PUBLIC-CONTENT | Inherited + route reader (see baseline source roots) | Primary implementer / scoped package |
| c/[slug]/m/[fixtureNumber]/board/page.tsx | PUBLIC-MATCH | dynamic, metadata, notFound | Primary implementer / scoped package |
| c/[slug]/m/[fixtureNumber]/overlay/page.tsx | PUBLIC-MATCH | dynamic, metadata, notFound | Primary implementer / scoped package |
| c/[slug]/m/[fixtureNumber]/page.tsx | PUBLIC-MATCH | dynamic, metadata, notFound, publicPage, notFound, currentSession | Primary implementer / scoped package |
| c/[slug]/p/[number]/insights/page.tsx | PUBLIC-PROFILE | dynamic, metadata, notFound, notFound | Primary implementer / scoped package |
| c/[slug]/p/[number]/page.tsx | PUBLIC-PROFILE | notFound | Primary implementer / scoped package |
| c/[slug]/page.tsx | PUBLIC-SEASON | notFound, currentSession | Primary implementer / scoped package |
| c/[slug]/t/[team]/page.tsx | PUBLIC-PROFILE | notFound | Primary implementer / scoped package |
| careers/page.tsx | PUBLIC-UNLISTED | metadata | Primary implementer / scoped package |
| case-studies/[slug]/page.tsx | PUBLIC-CONTENT | dynamic, notFound | Primary implementer / scoped package |
| case-studies/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| compare/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| compare/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| contact/page.tsx | PUBLIC-UNLISTED | metadata | Primary implementer / scoped package |
| demo/[token]/page.tsx | TOKEN-INTENT | metadata, dynamic, notFound | Primary implementer / scoped package |
| dev/inbox/page.tsx | DEV | dynamic, notFound | Primary implementer / scoped package |
| email/unsubscribe/page.tsx | TOKEN-INTENT | metadata | Primary implementer / scoped package |
| embed/[slug]/page.tsx | EMBED | metadata, notFound | Primary implementer / scoped package |
| features/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| for/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| for/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| founding-25/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| gallery/emails/page.tsx | DEV | metadata | Primary implementer / scoped package |
| gallery/page.tsx | DEV | Inherited + route reader (see baseline source roots) | Primary implementer / scoped package |
| guides/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| guides/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| help/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| help/category/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| help/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| home/page.tsx | OPS | metadata, currentSession, redirect, redirect | Primary implementer / scoped package |
| inbox/page.tsx | OPS | metadata, dynamic, currentSession, redirect, redirect, redirect, redirect | Primary implementer / scoped package |
| join/[token]/page.tsx | TOKEN-INTENT | metadata, currentSession, redirect | Primary implementer / scoped package |
| legal/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| legal/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| login/page.tsx | PUBLIC-UNLISTED | metadata, currentSession, redirect | Primary implementer / scoped package |
| m/[shareToken]/page.tsx | TOKEN-MATCH | dynamic, metadata, publicPage, notFound, currentSession | Primary implementer / scoped package |
| match/confirm/[token]/page.tsx | TOKEN-CONFIRM | dynamic, metadata, notFound, currentSession, redirect, notFound, notFound | Primary implementer / scoped package |
| me/[sport]/page.tsx | SELF | notFound | Primary implementer / scoped package |
| me/insights/page.tsx | SELF | dynamic, metadata, currentSession, redirect | Primary implementer / scoped package |
| me/page.tsx | SELF | metadata, currentSession, redirect, redirect | Primary implementer / scoped package |
| money/page.tsx | OPS | metadata, currentSession, redirect | Primary implementer / scoped package |
| newsletter/unsubscribe/page.tsx | PUBLIC-UNLISTED | metadata | Primary implementer / scoped package |
| onboarding/page.tsx | OPS | metadata, currentSession, redirect, redirect | Primary implementer / scoped package |
| org/[slug]/money/deliveries/page.tsx | OPS | metadata, financeGate, notFound, notFound | Primary implementer / scoped package |
| org/[slug]/money/documents/[docId]/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| org/[slug]/money/page.tsx | OPS | metadata, financeGate, notFound, notFound | Primary implementer / scoped package |
| org/[slug]/money/reconciliation/page.tsx | OPS | metadata, financeGate, notFound, notFound | Primary implementer / scoped package |
| org/[slug]/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| org/[slug]/settlement/page.tsx | OPS | metadata, settlementDeskGate, notFound, notFound | Primary implementer / scoped package |
| org/[slug]/t/[tournament]/page.tsx | OPS | metadata, notFound, redirect | Primary implementer / scoped package |
| org/[slug]/venues/page.tsx | OPS | metadata, notFound, redirect | Primary implementer / scoped package |
| orgs/page.tsx | OPS | metadata, currentSession, redirect | Primary implementer / scoped package |
| owner-join/[token]/page.tsx | TOKEN-INTENT | metadata, currentSession, redirect, redirect | Primary implementer / scoped package |
| page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| players/page.tsx | OPS | metadata | Primary implementer / scoped package |
| pricing/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| releases/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| reports/page.tsx | OPS | metadata | Primary implementer / scoped package |
| review/[token]/page.tsx | TOKEN-FEEDBACK | metadata, dynamic, notFound, notFound | Primary implementer / scoped package |
| rules-guidelines/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| schedule-demo/booked/page.tsx | PUBLIC-UNLISTED | metadata | Primary implementer / scoped package |
| schedule-demo/page.tsx | PUBLIC-CONTENT | metadata, dynamic | Primary implementer / scoped package |
| schedule-demo/pick/page.tsx | PUBLIC-UNLISTED | metadata, dynamic, notFound, notFound, redirect | Primary implementer / scoped package |
| score/[fixtureId]/page.tsx | OPS | dynamic, metadata, currentSession, redirect, redirect, notFound | Primary implementer / scoped package |
| score/[fixtureId]/setup/page.tsx | OPS | dynamic, metadata, currentSession, redirect, notFound, redirect | Primary implementer / scoped package |
| score/handover/[token]/page.tsx | TOKEN-INTENT | dynamic, metadata, currentSession, redirect | Primary implementer / scoped package |
| score/new/page.tsx | OPS | dynamic, metadata, currentSession, redirect | Primary implementer / scoped package |
| score/page.tsx | OPS | dynamic, metadata, currentSession, redirect | Primary implementer / scoped package |
| score/shell/page.tsx | OPS | dynamic, metadata | Primary implementer / scoped package |
| search/page.tsx | PUBLIC-UNLISTED | metadata | Primary implementer / scoped package |
| seasons/[slug]/auction/board/page.tsx | PUBLIC-BROADCAST | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/cockpit/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/engine/page.tsx | OPS | metadata, notFound, redirect | Primary implementer / scoped package |
| seasons/[slug]/auction/ledger/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/live/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/overlay/page.tsx | PUBLIC-BROADCAST | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/page.tsx | OPS | metadata, requireOnboarded, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/plan/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/replay/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/auction/spectate/page.tsx | PUBLIC-SPECTATE | notFound | Primary implementer / scoped package |
| seasons/[slug]/awards/page.tsx | OPS | dynamic, metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/brief/[fixtureId]/page.tsx | OPS | dynamic, metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/fixtures/calendar/page.tsx | OPS | redirect | Primary implementer / scoped package |
| seasons/[slug]/fixtures/match-day/page.tsx | OPS | redirect | Primary implementer / scoped package |
| seasons/[slug]/fixtures/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/fixtures/today/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/lineups/page.tsx | OPS | redirect | Primary implementer / scoped package |
| seasons/[slug]/money/case/[caseId]/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/money/page.tsx | OPS | metadata, currentSession, notFound, notFound | Primary implementer / scoped package |
| seasons/[slug]/page.tsx | OPS | metadata, requireOnboarded, currentSession, notFound | Primary implementer / scoped package |
| seasons/[slug]/posters/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/readiness/page.tsx | OPS | metadata, notFound, redirect | Primary implementer / scoped package |
| seasons/[slug]/register/page.tsx | PUBLIC-REGISTRATION | currentSession, redirect | Primary implementer / scoped package |
| seasons/[slug]/registrations/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/reviews/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/standings/page.tsx | OPS | metadata, notFound | Primary implementer / scoped package |
| seasons/[slug]/teams/page.tsx | OPS | metadata, currentSession, notFound | Primary implementer / scoped package |
| seasons/page.tsx | OPS | redirect | Primary implementer / scoped package |
| security/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| sports/[slug]/page.tsx | PUBLIC-CONTENT | notFound | Primary implementer / scoped package |
| sports/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| support/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| tools/page.tsx | PUBLIC-CONTENT | metadata | Primary implementer / scoped package |
| tools/purse-calculator/page.tsx | PUBLIC-CONTENT | metadata, requireToolPage | Primary implementer / scoped package |
| tools/registration-form/page.tsx | PUBLIC-CONTENT | metadata, requireToolPage | Primary implementer / scoped package |
| tools/snake-draft/page.tsx | PUBLIC-CONTENT | metadata, requireToolPage | Primary implementer / scoped package |
| tournaments/[slug]/page.tsx | OPS | notFound | Primary implementer / scoped package |
| tournaments/page.tsx | OPS | metadata, currentSession, redirect | Primary implementer / scoped package |
