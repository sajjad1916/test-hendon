# Hendon Signal Agent — PRD v1.0

**Client**: Joseph Hertz — Hendon Partners | **Date**: 2026-04-16 | **Build Type**: New

---

## One-Line Summary

Replaces Hendon's expensive Clay enrichment workflow with an agentic monitor that processes 24K+ home care agencies on a rolling 3-month cycle, surfaces the right sellers at the right moment via a daily Google Sheet drop, and frees Victor to spend his time on creative outreach instead of data acquisition.

---

## Build Spec

_Share this section with the customer for approval before starting the build._

- Build and maintain a master TAM list of U.S. home care, home health, and hospice agencies, filtered to Hendon's ICP (Medicaid-primary; Medicare in priority states)
- Monitor every agency on a rolling cycle (full TAM cycled every ~3 months) for sale-readiness signals — owner age, hiring a GM, Google review velocity, ad activity changes, website changes, LinkedIn activity, and "nearby Hendon closed deal" internal signals
- Classify each lead into Hot (call now), Warm (Instantly campaign), or Long-term (touch every 6 months) tiers, with deduplication so no lead surfaces more than once every two months
- Deliver a daily Google Sheet drop with new and re-prioritized leads — agency, owner, contact info, signal explanation, priority tier, ICP fit — formatted like the gym-leads example shared on the call
- Expose the same data via API so Victor can plug it directly into Instantly or other downstream tools

---

## Company & Problem Context

_Researched from the customer's website and transcript._

**Company:** Hendon Partners is an M&A advisory firm working exclusively in home care, home health, and hospice transactions. They run a confidential, structured sell-side process that creates buyer competition (typical close in 60–120 days) and provide buy-side advisory for PE platforms, health systems, and regional operators. They focus on the lower middle market ($50K–$5M SDE) and have closed deals in 12+ states over the last twelve months. Founded by Neli Gertner; recently brought GTM lead Victor in-house to run outbound.

**Problem:** Joseph's TAM is roughly 24,000 home care agencies, but the team has no economical way to spot the moment an owner becomes ready to sell. Today, Victor enriches leads through Clay (which he flagged as his "biggest limiter" — "very, very expensive," and a recent ~3x price increase made it worse) and runs short transactional outbound through Instantly with nine inboxes. Clay charges per data point per agency, with no way to know in advance which signal is worth checking, so Hendon either over-spends on enrichment or misses owners at the exact moment of intent. The deals Hendon closes are almost always need-driven — owners nearing retirement, relocating, or experiencing a personal change — but those signals are scattered across Google Maps, agency websites, LinkedIn, ad platforms, and state portals. No one on the team can manually search 24K agencies for these signals, and Clay isn't built to do it cheaply at TAM scale. This build replaces Clay's enrichment loop with a purpose-built agentic monitor that cycles the entire TAM every ~3 months, detects the signals Joseph and Jon defined on the call, and drops prioritized leads into a Google Sheet daily — letting Victor stop fighting data acquisition and spend his time on creative, high-ROI outreach. Joseph's reaction at the end of the call: "It sounds really, really compelling. There's definitely a ton of value we're not tapping into."

---

## Developer Brief

_Quick context for the engineer._

- **The build is signal detection, not outreach.** Victor owns campaign engineering in Instantly. The agent's job is to figure out *which* agencies are worth reaching out to *now*, not what to say. Don't get drawn into copy or sequencing.
- **The signals Joseph and Jon defined are the spec.** Owner age (retirement window), owner relocation/life change, hiring a GM (prepping the business to run without the owner), Google review count + velocity (size and growth proxy — "we use that one a ton" per Jon), ad activity changes (Zaki: "if they go from publishing four ads to 50, they probably placed an ad agency"), website changes (new pages, new offerings), LinkedIn activity (M&A engagement, retirement-adjacent posts), and the internal signal of a nearby Hendon closed deal ("we just sold Bob's in Cleveland — should I introduce myself to neighbors?").
- **TAM cycling, not real-time monitoring.** Process the full ~24K once every ~3 months in a rolling pattern (~2K agencies/week). Flag anything that crossed a threshold since the last check. Daily Google Sheet drop captures whatever crossed thresholds that day.
- **Three priority tiers come from Jon's "more wood behind fewer arrows" framework.** Hot = multiple signals or one strong one (e.g., owner 70+ AND hiring a GM) — call them, send lumpy mail. Warm = single signal or growth indicator — Instantly campaign. Long-term = no signals but should be touched at least every 6 months with educational content. Tunable rules; the engineer should make the thresholds configurable.
- **Output format is locked in.** Victor said "I would keep it simple, like, with the Google Spreadsheets." The gym-leads spreadsheet Zaki demoed at 30:00–32:04 (`screenshots/1_30m00s.jpg` through `63_32m04s.jpg`) is the format reference: per-row company + website + Reason (one-line signal) + multi-line Key Signals breakdown + contact + location + segment + current stack + people + outreach status. Daily date tabs at the bottom. Color coding for "do not contact" / "not interested." Engineer should review the screenshots before designing the output schema.
- **API is a secondary delivery path** for Victor — same data, JSON, so he can pull straight into Instantly or another tool without manual export.
- **ICP filter is critical.** Joseph: "Our best, closest fit in our ICP is Medicaid. I would say Medicare also for certain states." He'll provide a state priority list and ICP criteria document post-call. Don't process the full 24K until the filter is in.

---

## Prototype

_The first deliverable. Feature-complete with synthetic data — no live integrations needed. Customer plays with it before any credentials are exchanged._

**What the prototype delivers:**
- A working Google Sheet (Sagan-owned, demo) populated with ~80–120 synthetic home care agencies, formatted exactly like the gym-leads example. Columns: Created, Company, Domain, Reason, Address, Segment, Current Stack, Phone, Social Links, Email, Owner/People, Key Signals (multi-line breakdown), Country, Priority Tier, Notes, Salesperson. Daily date tabs at the bottom mirror the gym example.
- A scheduled run (Railway cron) that adds a fresh batch of synthetic "today" rows each cycle so the customer can watch the daily drop pattern in action.
- Three priority tiers visible — Hot rows highlighted, Warm and Long-term in distinct buckets — with the reason for each classification spelled out in the Key Signals column.
- A small internal demo dashboard (HTML + Tailwind + htmx) that shows the TAM cycling state: agencies processed this week, signals detected, leads classified by tier. Lets Joseph see how the cycle works without seeing raw data tables.
- An example of the API endpoint returning the same data as JSON, so Victor can verify the shape.

**What's simulated (demo mode):**
- Synthetic TAM of ~80–120 fake home care/home health/hospice agencies across 10–15 states (skewed toward likely-priority states like NY, NJ, FL, TX, CA pending Joseph's actual list). Names, websites, addresses, owner names — all fabricated but realistic.
- Signal generators produce believable signal events: ~15% of agencies show "owner 70+", ~10% show "hiring a GM", ~20% show "review velocity spike", ~10% show "new ad campaign", ~5% show "nearby Hendon closed deal." Mix is engineered so all three tiers (Hot/Warm/Long-term) populate visibly.
- Key Signals descriptions are AI-generated narratives (Lightweight tier) explaining *why* each lead made the list — same shape as the gym-leads "Closed Won LookAlike" / "Trial ReConverts" / "Hot Leads [FAA]" reasons visible in screenshots `15_30m28s.jpg`, `30_30m58s.jpg`, `45_31m28s.jpg`.
- No real Google Maps / LinkedIn / ad library scraping — agencies and signals are pre-generated and rotated daily.
- HubSpot "closed deal" feed is simulated by a static list of ~5 fake "Hendon recently closed" deals that drive the nearby-agency signal logic.

**To complete (what we need from the customer after prototype approval):**
- Hendon's existing TAM CSV (from Clay or wherever it currently lives) — used as the seed list
- Joseph's state priority list (which states are in scope, ranked) and ICP criteria document (Medicaid vs Medicare definitions, agency size thresholds, exclusions)
- Google Sheets credentials + the target Sheet ID (Victor to provide)
- HubSpot API key (for syncing Hendon's recently closed deals to drive the internal-signal logic)
- ZenRows + Serper API keys (Sagan-provisioned but counted against the build budget)
- OpenRouter API key (Sagan-provisioned)
- Optional: HubSpot enrichment push permissions if Hendon decides to mirror leads into HubSpot in addition to the Sheet

---

## Stack Suggestions

_Recommended tools and services, grounded in [stack.md](references/stack.md). The engineer may diverge if the project calls for it._

| Layer | Tool | Rationale |
|-------|------|-----------|
| Hosting | Railway | Sagan default per stack.md. Single service runs the agent, the cron-driven TAM cycle, the demo dashboard, and Postgres — no need to split. |
| Frontend | HTML + Tailwind CSS + htmx | Sagan default per stack.md. The only UI is an internal credit/usage/cycle dashboard — server-rendered fragments are sufficient. The customer-facing UI is the Google Sheet itself. |
| Backend | Hono (Node.js + TypeScript) | Sagan default per stack.md. Handles the API endpoint for Victor, the cron triggers, and the demo dashboard from one service. |
| Database | Postgres on Railway | Per stack.md — relational queries get complex here. 24K agencies × multiple signal types × historical events × dedup state × tier classification needs joins, indexes, and concurrent writers. SQLite would be tight. |
| Integrations | n8n | Per stack.md — orchestrates Google Sheets writes, optional HubSpot push, and webhook ingestion if Hendon wants to feed closed deals from HubSpot in real time. Not used for scheduling (Railway cron handles that). |
| Scraping | ZenRows + Serper | Per stack.md scraping defaults. Serper for Google Maps lookups (review counts, business info), ZenRows (premium_proxy + js_render) for agency websites, LinkedIn profiles, ad library pages, state portals. |
| AI | Lightweight tier (via OpenRouter) | Per stack.md AI tiers. Signal classification, LinkedIn profile parsing, website diff interpretation, Reason-line generation are high-frequency structured tasks — Lightweight is the right cost/performance profile. Reach for SoTA only if a specific signal needs nuanced reasoning. |

**Environment Variables**: `OPENROUTER_API_KEY`, `ZENROWS_API_KEY`, `SERPER_API_KEY`, `GOOGLE_SHEETS_CREDENTIALS_JSON`, `GOOGLE_SHEETS_SHEET_ID`, `HUBSPOT_API_KEY`, `DATABASE_URL`, `N8N_WEBHOOK_SECRET`, `API_BEARER_TOKEN` _(for Victor's pull endpoint)_

---

## Screen Share Timestamps

_Moments in the recording where the customer or Sagan shared their screen._

| Timestamp | Screenshots | Description | Relevance |
|-----------|-------------|-------------|-----------|
| 14:37–16:33 | _Before screenshot range_ | Victor showed the Instantly dashboard — overview stats and reply rate, then walked through the campaign template (short, transactional copy that's been outperforming the longer original). | Confirms that messaging/sequencing is Victor's domain and out of scope. The agent feeds Instantly, not the other way around. |
| 25:30–28:15 | _Before screenshot range_ | Zaki described the API + Google Sheet delivery model in detail; Victor confirmed Google Sheets as the simple-first format. | Anchors the "Google Sheet first, API second" delivery decision. |
| 30:00–32:04 | `1_30m00s.jpg` — `63_32m04s.jpg` (63 frames) | Zaki demoed the Sagan gym-leads spreadsheet ("SP x Gymdesk Daily Account Sheet") — daily date tabs, columns for Company / Domain / Reason / Key Signals (multi-line) / contact / segment / current stack / people / outreach notes. Visible signal types in the demo include "Closed Won LookAlike", "Trial ReConverts", "Hot Leads [FAA]", with red-highlighted rows for "do not contact". | **Critical** — this is the format Joseph approved by reaction. The engineer should review the screenshots end-to-end before designing the Sheet schema. Particularly useful: `1_30m00s.jpg` (top of sheet, columns), `15_30m28s.jpg` (Reason column with Trial ReConverts), `30_30m58s.jpg` (Hot Leads + Closed Won LookAlike), `45_31m28s.jpg` (Key Signals breakdown), `60_31m58s.jpg` (final formatted summary structure). |

---

## Key Definitions

_Domain terms the engineer needs to understand. Not a schema — the dev designs their own data model._

| Term | Meaning | Examples |
|------|---------|----------|
| Home Care Agency | A business providing in-home care services — personal care, companionship, skilled nursing | Visiting Angels, BrightStar Care, plus thousands of independent agencies |
| Home Health / Hospice | Adjacent verticals Hendon also serves; home health is clinical, hospice is end-of-life care | Often overlap with home care under one operator |
| Medicaid agency | State-funded home care provider — Hendon's primary ICP | Reimbursed by state Medicaid programs for personal care assistants |
| Medicare agency | Federal skilled-care provider — Hendon's secondary ICP, in selected states only | Skilled nursing visits, therapy |
| Private Pay | Owner pays directly out of pocket — lowest priority for Hendon | Not a Hendon focus |
| SDE | Seller's Discretionary Earnings — the profit metric small businesses are valued on | "$500K SDE" ≈ $500K/year of owner benefit |
| Lower Middle Market | Hendon's deal size band — roughly $50K to $5M SDE | A typical Hendon engagement |
| TAM | Hendon's total addressable market — ~24,000 U.S. home care agencies | The full list the agent processes |
| Signal | An external indicator that an owner may be moving toward a sale, or worth tracking for relationship-building | Owner turns 70, agency hires a GM, review count doubles in 6 months, nearby Hendon deal closes |
| Internal Signal | A signal that originates inside Hendon — typically a recently closed deal | "We just sold Bob's in Cleveland — let's introduce ourselves to nearby agencies" |
| Lookalike | A prospect that resembles a past closed deal in segment, size, or location — Sagan's gym-leads demo flags these explicitly | "Closed Won LookAlike of Krossface Jiu Jitsu" |
| Hot / Warm / Long-term | The three priority tiers from Jon's "more wood behind fewer arrows" framework | Hot = call now; Warm = Instantly campaign; Long-term = touch every 6 months |
| Lumpy Mail | Physical mail with a dimensional object (golf ball, book, etc.) — Hendon's high-touch outreach for hot leads only | "Mail them a golf ball with a handwritten note saying 'you should be golfing'" — Jon |
| Instantly | Cold email platform Victor uses, currently with 9 inboxes | The primary outbound channel Hendon runs through |
| Clay | The data enrichment platform Victor currently uses — the cost limiter this build replaces for enrichment | "Ironically expensive" — Jon |

---

## User Stories

_Each user story maps to a Build Spec bullet. The assigned engineer will review the transcript independently and make their own implementation decisions._

### User Story 1: Build and maintain an ICP-filtered TAM list of home care agencies

**Implementation Considerations:**
- Joseph will provide the existing TAM list (currently in Clay) plus a state priority list and an ICP criteria document post-call. Don't begin TAM enrichment until both are in hand — prototype runs on synthetic data while the engineer waits.
- ICP filter has two layers: (a) agency type — Medicaid primary, Medicare in priority states only, exclude private-pay-only; (b) geography — Joseph's state priority list. Make both configurable; Joseph should be able to expand or tighten without engineering changes.
- For agencies missing from Hendon's seed list, Google Maps via Serper is the cheapest source of truth ("local businesses, that's really a good sort of truth there" — Zaki at [12:43]). State licensing portal data is partial and varies by state — Victor confirmed at [06:39] that government databases don't share patient counts; license type may still be useful for Medicaid/Medicare classification where available.
- Postgres schema should support per-agency timestamps for change tracking — every signal check needs to be logged so dedup and "last seen" logic works across the 3-month cycle.
- LinkedIn coverage is incomplete: Joseph estimated <50% of owners have profiles, and "probably most are inactive" [13:02]. Don't assume LinkedIn data is available; design the signal logic to work even when it's missing.

### User Story 2: Monitor each agency on a rolling cycle for sale-readiness signals

**Implementation Considerations:**
- Cycle target: full TAM every ~3 months, processed in a rolling pattern of roughly 2K agencies per week. Use Railway cron — never n8n for scheduling per stack.md.
- Signal set committed on the call: owner age (retirement proximity), owner relocation/life change, hiring a GM/manager, Google review count + velocity, ad activity changes, website changes (new pages, new offerings), LinkedIn activity, and "nearby Hendon closed deal" internal signal. Don't over-engineer beyond this set in v1; Jon noted "it's a really fun exercise in creativity… it's easy for us to add another signal" — so design for extension, not exhaustive coverage now.
- "Nearby closed deal" needs Hendon's recent closed-deal feed. Cleanest path: HubSpot API for closed deals (Hendon is a HubSpot CRM customer — gym example showed HubSpot integration). Verify with Joseph whether deals are tracked there; if not, fall back to manual CSV upload.
- Owner age inference from LinkedIn is approximate at best — graduation year is the typical proxy. Be honest in the Reason line: "Owner appears 65+ based on LinkedIn graduation year" beats false precision.
- Ad activity check — Google Ads Transparency Center is the most accessible source; Facebook Ads Library is a secondary option. Both are scrapable but volatile — expect to revisit selectors.
- A Lightweight-tier model is the right call for normalizing scraped data and writing the Reason line. Reach for SoTA only if a specific signal type proves to need richer interpretation.
- Per-agency rate limits and cost ceilings — at 2K agencies/week × multiple sources per agency, request volume and cost can run away fast. Build a per-cycle budget cap and per-source error budget so a flaky source doesn't crater the run.

### User Story 3: Classify each lead into Hot / Warm / Long-term and dedupe

**Implementation Considerations:**
- Tier rules from Jon at [19:39]: Hot = "if they're over 70 and this — top of the list"; Warm = "if they're just over 70" or single growth signal; Long-term = "under 30 and this — CRM drip campaign." Make the rule weights configurable in a Postgres table, not hard-coded — Joseph and Jon both noted the rules will need tuning as Hendon learns which signals actually predict deals.
- Dedup window is 2 months per Zaki at [26:06]: "don't reach out to us the same lead, you know, more than once every two months." Track surface history per agency and suppress re-surfacing within the window unless a *new* high-strength signal appears (e.g., a Long-term lead jumps to Hot — that should override the cooldown).
- Long-term floor: Zaki at [26:06] said "we'll make sure we hit up everyone at least once every six months." Long-term leads need a recurring scheduled drop independent of new signals.
- Internal signals (nearby closed deal) are special — they should be able to *promote* leads regardless of cooldown ("we just sold Bob's in Cleveland" — Jon at [31:10]).
- Surface a "why this tier" explanation for every lead. The Reason and Key Signals columns in the gym demo are the model — keep them human-readable so Victor and the calling team understand the priority instantly.

### User Story 4: Daily Google Sheet drop in the gym-leads format

**Implementation Considerations:**
- Match the gym-leads sheet structure: Created date, HubSpot link (if applicable), Company, Domain, Reason (one-line signal summary), address fields, Segment (e.g., "medicaid_homecare"), Current Stack/Competitor (if known), Phone, Social URLs (Instagram, Facebook, LinkedIn), Email, People (owner/principal), Key Signals (multi-line breakdown including company description, location, timezone, segment, key signals, lookalike if applicable), Country, Priority Tier, Notes, Salesperson assigned. Reference screenshots `1_30m00s.jpg` through `63_32m04s.jpg` for exact column layout.
- Daily date tabs at the bottom of the workbook (gym example shows tabs for 10/09, 10/10, 10/13, etc.) — each day is a fresh tab with that day's drop. Older tabs preserved for history.
- Color coding: red rows for excluded/do-not-contact (visible in screenshots `1_30m00s.jpg` and `60_31m58s.jpg`), neutral for active, green or other for completed outreach. Coordinate with Victor on the exact convention before launch.
- n8n is a fine fit for the Sheets write itself — Google Sheets API has rate limits and n8n's Sheets node handles them.
- Sheet permissions: confirm whether Hendon wants the Sheet in their Google Workspace (so Victor and the calling team can edit notes/disposition) or in Sagan's, with view+edit shared. The gym example was clearly in the customer's workspace.

### User Story 5: API endpoint exposing the same data for downstream tools

**Implementation Considerations:**
- Single GET endpoint returning JSON of the same daily drop, with optional query params for tier, state, and date range. Bearer-token auth — Victor gets one token.
- Pagination: even at modest daily volumes, Hot+Warm+Long-term combined can be hundreds of leads — paginate by date or page.
- Schema should mirror the Sheet columns 1:1 so the API is just a different transport for the same data — easier for Victor to mentally map.
- Document the endpoint in a one-pager for Victor (curl example, JSON shape, common params). Don't over-design — Victor said "I would keep it simple" at [25:53].
- If Hendon later wants n8n-driven push into HubSpot or Instantly directly (vs Victor pulling), the same endpoint can be called from n8n — no extra work needed.

---

## Data Sources

_All external systems the build connects to._

| Source | Type | Direction | Integration Method | Notes |
|--------|------|-----------|-------------------|-------|
| Hendon TAM seed list | CSV / file | In | Manual upload (one-time, refreshed as Joseph provides updates) | Currently lives in Clay. Joseph will export and send post-call. |
| Google Maps | Scraping | In | Serper search + ZenRows scraping (premium_proxy + js_render) | Business name, address, phone, review count, review velocity. Primary "source of truth" for local-business existence per Zaki at [12:43]. |
| Agency websites | Scraping | In | ZenRows (premium_proxy + js_render) | New pages, service offerings, "about" pages for owner info, new GM hire announcements. |
| LinkedIn | Scraping | In | Serper search + ZenRows scraping | Owner name, age estimate (graduation year proxy), activity, M&A engagement, job postings (especially GM/manager roles). Coverage is partial — design around it being missing. |
| Google Ads Transparency Center | Scraping | In | ZenRows | Ad volume changes per agency, indicating growth or new ad agency engagement. |
| State licensing portals | Scraping | In | ZenRows (per-state, custom selectors) | Variable per state. Useful for Medicaid/Medicare classification where available. Patient counts not available per Victor [06:39]. |
| Hendon HubSpot (closed deals) | API | In | HubSpot REST API (`@hubspot/api-client`) — direct from backend per stack.md | Drives the "nearby Hendon closed deal" internal signal. Confirm with Joseph that closed deals are tracked in HubSpot before relying on this. |
| Google Sheets | API | Out | n8n Sheets node, or Google Sheets API direct | Primary delivery channel — daily drop. Customer-owned workspace preferred. |
| Hendon API consumer (Victor) | HTTP | Out | Hono endpoint with Bearer-token auth | Same data as the Sheet, JSON. For Instantly ingestion or future routing. |
| HubSpot enrichment push | API | Out (optional) | n8n HubSpot node | Discussed but not confirmed — Victor preferred the Sheet for simplicity. Wire only if Joseph confirms post-prototype. |

---

## Discussed But Not Confirmed

_These items came up in the transcript but were not explicitly committed to. Verify with the customer before including in the build._

- **HubSpot enrichment push.** Zaki noted the gym-leads customer also gets data pushed into HubSpot. Victor's stated preference for Hendon was to "keep it simple, like, with the Google Spreadsheets" [25:53]. Confirm with Joseph after prototype whether Hendon also wants HubSpot mirroring.
- **Internal credit/usage dashboard.** Zaki offered at [26:06]: "We can give you, like, a dashboard to see how many credits you're consuming and what signals are being generated and cost associated." A small internal dashboard is included in the prototype scope to demonstrate cycle state, but full-featured credit tracking wasn't explicitly committed to — confirm depth with Joseph.
- **Source for the "nearby closed deal" internal signal.** Jon strongly proposed it at [31:10] and the principle was clearly accepted, but the source (HubSpot deal stage vs manual CSV vs n8n webhook) wasn't pinned down. HubSpot is the obvious default given Hendon's CRM, but verify on the next call.
- **Lawyers / healthcare M&A specialty lawyers as a referral source.** Joseph confirmed at [11:39] that lawyers specialized in healthcare M&A are Hendon's best lead source ("accountants a little bit less so"). Not scoped into the agent in v1, but a future signal: monitor for new healthcare M&A lawyer activity, partnerships, or content. Confirm if Joseph wants this in a later phase.
- **Facebook group monitoring.** Joseph mentioned at [29:41] a Facebook group exists for home care owners. Could be a future signal source. Not in scope for v1.
- **Categorical licensure as a size proxy.** Jon's idea at [06:49] of using on-site kitchen permits or similar as an indirect size signal. Joseph: "I haven't thought about it enough. We gotta… maybe." Aspirational; not in scope.

---

## Out of Scope (Future Phases)

_These were discussed but deferred. Preserved here so nothing is lost._

- **Campaign copy and messaging.** Victor owns campaign engineering in Instantly. The agent provides data, not outreach copy.
- **Multichannel orchestration.** Coordinating LinkedIn, email, and physical mail sequences is Victor's job using the data the agent provides. Zaki at [17:11]: "I wanna see you guys do the latter" — referring to creative campaign work.
- **Lumpy mail execution.** Jon's golf-ball-with-a-handwritten-note example for hot leads — operational, Hendon executes, not Sagan.
- **LinkedIn outreach automation (Dripify, HeyReach).** Joseph mentioned needing a better LinkedIn messaging strategy [13:02]. Out of scope — agent provides LinkedIn profile data; Victor handles the messaging tools.
- **AI phone calling for hot leads.** Suggested by Sagan — not discussed on the call. Natural future extension once tier classification is reliable.
- **Conference attendee lists as a signal source.** Jon mentioned at [28:15]. Aspirational.
- **Predictive analytics on signal-to-deal conversion.** No discussion on call, but the obvious follow-on once 6+ months of signal history accrues — which signals actually predict closed deals.

---

## Confidence Score

_How well-scoped is this build? Scored across three dimensions, each out of 5. Overall = the lowest score._

| Dimension | Score | Notes |
|-----------|-------|-------|
| Scope Definition | 4/5 | Clear deliverable (daily prioritized Sheet + API). Output format pinned by the gym example. Signal set defined explicitly by Joseph and Jon. Two pieces still pending from Joseph: state priority list and ICP criteria document. Six items moved to "Discussed But Not Confirmed" during the audit — clean separation. |
| Technical Feasibility | 3/5 | The mechanics (Google Maps, websites, ad library scraping at TAM scale) are doable with ZenRows + Serper. Risk is concentrated in: LinkedIn (Joseph said <50% coverage, "probably most are inactive"), state licensing portal variation, owner-age inference accuracy, and per-cycle cost discipline at 24K × multi-source. None are blockers but each adds uncertainty. |
| Customer Impact | 5/5 | Replaces Clay's most expensive workflow, surfaces missed deal opportunities across a 24K TAM, and shifts Victor's time from data acquisition to creative outreach (where his comparative advantage is). Joseph: "It sounds really, really compelling. There's definitely a ton of value we're not tapping into." |
| **Overall** | **3/5** | **= lowest of the three (Technical Feasibility)** |

**Score bands**: 5 = high confidence, 4 = solid, 3 = gaps exist, 2 = significant unknowns, 1 = not buildable yet.

Note: Despite the 3 on technical feasibility, the prototype is fully buildable on synthetic data and can fully demonstrate the value before any customer credentials are exchanged. The technical risk is in the production cycle's reliability and economics, not in proving the concept to Joseph.

---

## Audit Notes

_Summary of the verification audit performed before finalizing this PRD._

All five user stories traced to explicit transcript moments:
- **TAM build & ICP filter** — Joseph at [20:42] (Medicaid primary, Medicare select states), Zaki at [22:53] (full set of TAM), Joseph at [21:48] (Clay is current source).
- **Signal monitoring** — Every signal type cited individually: owner age [03:18], hiring GM [05:29], Google reviews [05:48], ad activity [22:53], website changes [22:53], LinkedIn activity [13:02], internal closed-deal signal [31:10].
- **Tier classification + dedup** — Jon's "more wood behind fewer arrows" framework [19:39, 20:31]; dedup 2-month rule and 6-month long-term floor from Zaki [26:06].
- **Daily Google Sheet drop** — Victor's explicit format choice [25:53]; Zaki's daily cadence confirmation [26:06]; gym example demo [29:47–32:04] as the format reference.
- **API endpoint** — Zaki at [17:11] and again at [26:06].

Six items moved to **Discussed But Not Confirmed** during audit — HubSpot enrichment push, internal credit dashboard, internal-signal source mechanism, lawyer referral signals, Facebook group monitoring, categorical-licensure size proxy. None of these were promoted into the user stories without explicit customer confirmation.

**Prototype audit**: prototype is fully buildable with synthetic data — no customer credentials required to ship the first deliverable. The synthetic agency set, signal mix, and Sheet format all map to what was discussed. "To Complete" items (TAM CSV, state priority list, ICP criteria, Google Sheets credentials, HubSpot key) are all real post-prototype needs traceable to specific transcript moments. The prototype demonstrates the core problem (signal-driven prioritization at TAM scale, gym-leads-style output) end-to-end, so it should give Joseph and Victor a concrete artifact to react to before live integrations begin.

No red flags found — every feature in this PRD has a clear conversational basis in the transcript, the company website context, or the explicit gym-leads format demo.
