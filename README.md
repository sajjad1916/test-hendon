# Hendon Signal Agent — Prototype

A fixture-driven prototype of the Hendon Signal Agent for Hendon Partners
(home-care M&A advisory). Replaces their expensive Clay enrichment workflow
with an agentic monitor that:

1. Ingests a TAM (Total Addressable Market) of home-care agencies via CSV upload
2. Applies a configurable two-stage ICP filter (service-type + license/location)
3. Generates sale-readiness signals (owner age, hiring GM, review velocity, ad activity, nearby Hendon closed deal)
4. Classifies each agency into Hot / Warm / Long-term tiers with cooldown + override
5. Writes a daily Google Sheet drop in the gym-leads format Joseph already approved
6. Exposes the same data over a JSON API for direct ingestion into Instantly

**The prototype runs entirely on synthetic data and fixture-driven external responses.** The only real outbound API call is writing to the live demo Google Sheet — and that only fires when `GOOGLE_SHEETS_*` env vars are set. Run anywhere, anytime, no credentials needed.

**Stack:** Hono + TypeScript on Node 20, SQLite via better-sqlite3, server-rendered HTML with Tailwind (CDN) and htmx, Inter typography, googleapis for the Sheets write.

---

## Quick start (3 minutes from clone to running demo)

```sh
# 1. Install
npm install

# 2. Build the demo state from scratch (each step is idempotent)
npm run seed              # 100 synthetic agencies
npm run generate-signals  # ~50 signal events (today)
npm run seed-history      # ~230 backdated signal events + 35 surface_history rows
npm run classify          # surface today's leads (with dedup + cooldown)
npm run fill-reasons      # populate Reason + Key Signals from fixture pool

# 3. Boot the server
npm run dev               # http://localhost:3000

# 4. Open the dashboard
open http://localhost:3000/admin
```

Ports: defaults to 3000, override with `PORT=...`. Database file: `hendon.sqlite` in the project root (gitignored).

For the **live Google Sheet write**, set the two env vars in `.env` and run `npm run write-sheet` — see [Environment variables](#environment-variables) below.

---

## The demo — Joseph's walk-through (condensed)

This is what you click in what order to demo the prototype.

1. **Visit `/admin`** — if the database is empty, you'll be redirected to `/admin/upload` (first-visit-empty redirect).
2. **At `/admin/upload`**, drop a CSV in. The minimum required columns are `company_name` + `company_url`. Everything else is optional. Try the test fixture in the slice-10 verification: a 5-row Clay-style CSV.
3. **Step 2 (Review)** swaps in via htmx — bucket pills (NEW / EXISTING / MISSING), ICP classification preview, recognized vs ignored columns. Click **Commit**.
4. **Step 3 (Result)** confirms inserts + auto-enrichment. The "Last upload" tile and "Recent uploads" table refresh in place via htmx OOB swap.
5. **Click `Set lead quota →`** — lands on `/admin/quota`. Two numeric inputs, live cost-line updates as you type ("$0.07 / day at 100 leads/day · ~238 days to finish"). Save.
6. **Click `Settings`** in the brand-strip nav — 8 numbered sections (Signals · Tier rules · Dedup · ICP rules · Priority states · Lead quotas · Output channels · AI narrative). Each section saves independently with an inline pill.
7. **Back to `/admin`** — see the dashboard: 4 tiles (Total / Pending / Classified / Excluded), today's quota progress with a cost line, signals-by-type bar chart, tier breakdown, recent uploads table.
8. **Click `Run today's cycle now →`** — the demo button. Generates fresh signals on un-surfaced agencies, classifies, fills Reasons, builds Sheet rows, writes to the live Sheet (or stays dry-run if `GOOGLE_SHEETS_*` aren't set). Returns an emerald success card and OOB-swaps the dashboard tiles. ~1 second end-to-end.
9. **`curl` the API** with the bearer token from `.env`:
   ```sh
   curl -H "Authorization: Bearer $API_BEARER_TOKEN" http://localhost:3000/api/leads?tier=hot | jq
   ```
   Same data as the Sheet, JSON-shaped for Instantly.
10. **Toggle a signal off** in `/admin/settings` → re-run cycle → watch the Hot count drop (because some agencies were Hot only because of that signal). Re-enable, re-run, count restores.

That's the demo. ~5 minutes if you walk it slowly.

---

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Hot-reload dev server via `tsx watch`. Default port 3000. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | Compiles to `dist/`. |
| `npm run start` | Runs `dist/server.js` (after `build`). |
| `npm run seed` | Populates `hendon.sqlite` with 100 synthetic agencies + a fake "initial upload" row. Idempotent. |
| `npm run generate-signals` | Truncates `signal_events`, runs all 5 generators across active agencies. PRD-mix percentages (15/10/20/10/5). |
| `npm run seed-history` | Backdates ~230 signal events across the past 90 days (additive — preserves today's events) + populates `surface_history` for ~35 agencies. |
| `npm run classify` | Computes tier per agency, applies dedup (60-day cooldown + internal-signal bypass + Long-term→Hot promotion), UPSERTs `daily_drop`. |
| `npm run fill-reasons` | Fills empty `daily_drop.reason` / `key_signals` from the fixture pool. Deterministic on (agency, signal-set). |
| `npm run write-sheet` | Writes today's `daily_drop` to the configured Google Sheet (or dry-run if env vars are unset). |
| `npm run seed-sheet-tabs` | Pre-populates 4 historical date tabs (today−14, −7, −3, −1) for visual continuity on a fresh demo. |

Typical demo build chain: `npm run seed && npm run generate-signals && npm run seed-history && npm run classify && npm run fill-reasons`.

---

## Environment variables

Copy `.env.example` to `.env` first.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Dev server port. |
| `DATABASE_PATH` | `./hendon.sqlite` | SQLite file location. |
| `GOOGLE_SHEETS_SHEET_ID` | _(unset)_ | The Google Sheet to write to. Leave blank for dry-run mode. |
| `GOOGLE_SHEETS_CREDENTIALS_JSON_PATH` | `./.credentials/sheets-sa.json` | Path to a Google service-account JSON file. The service account email needs Editor permission on the Sheet. |
| `API_BEARER_TOKEN` | _(unset)_ | Single bearer token for `GET /api/leads`. If unset, the API returns 500. **Rotate before any real handoff.** |

The Sheets writer falls back to dry-run mode when either Sheets var is unset — no network calls, just a 5-row preview to stdout.

---

## API

Single endpoint, bearer-token auth.

```sh
curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
  "http://localhost:3000/api/leads?tier=hot&date=2026-05-06" | jq
```

Response shape:
```json
{
  "tab": "2026-05-06",
  "filters": { "tier": "hot", "date": "2026-05-06" },
  "count": 43,
  "leads": [
    {
      "agencyId": 1309,
      "created": "2026-05-06",
      "company": "Maple Home Care",
      "domain": "maplehomecare.com",
      "reason": "Sharp ad-volume jump plus an operations hire suggests a scaling and prepping pattern.",
      "address": "1241 Cedar Pkwy, Naperville, IL 28288",
      "segment": "medicare_homecare",
      "currentStack": "",
      "phone": "+12982891374",
      "socialLinks": "",
      "email": "",
      "ownerPeople": "Edward Adams",
      "keySignals": "Ad activity: 4 → 47 ads/month (likely retained an agency)\nHiring: Operations Manager (careers page, 11 days ago)\n…",
      "country": "US",
      "priorityTier": "Hot",
      "notes": "",
      "salesperson": ""
    }
  ]
}
```

Query params:
- `tier` — optional. One of `hot`, `warm`, `long_term`. Invalid values silently drop.
- `date` — optional. ISO date `YYYY-MM-DD`. Invalid values fall back to today's UTC date.

Auth failures return 401 JSON. Missing `API_BEARER_TOKEN` env var returns 500.

---

## Architecture

```
src/
├── server.ts                       Hono entrypoint, registers all routes
├── db.ts                           better-sqlite3 handle + auto-migration runner
├── db/migrations/
│   ├── 001_initial.sql             6-table schema (agencies, signal_events, daily_drop, surface_history, settings, uploads)
│   └── 002_upload_helpers.sql      agency_type, icp_status, upload_draft_rows, hendon_closed_deals, ICP/quota/dedup settings seed
├── config/
│   └── sheets.ts                   GOOGLE_SHEETS_* env reader (discriminated union)
├── routes/
│   ├── admin-upload.ts             /admin/upload — TAM ingestion (Step 1 → 2 → 3 htmx flow)
│   ├── admin-quota.ts              /admin/quota — lead quota + live cost line
│   ├── admin-settings.ts           /admin/settings — 8-section toggle panel
│   ├── admin.ts                    /admin — dashboard + POST /run-cycle
│   └── api.ts                      /api/leads — bearer-token JSON
├── views/
│   ├── _layout.html                Brand strip + Tailwind config + Inter font
│   ├── admin-upload.html           Pre-upload page wrapping the work-card host
│   ├── _step-review.html           Step-2 fragment (validate → review)
│   ├── _step-result.html           Step-3 fragment (commit → result, with OOB swaps)
│   ├── admin-quota.html            Lead quota inputs
│   ├── admin-settings.html         Settings toggle panel
│   └── admin.html                  Dashboard
└── lib/
    ├── render.ts                   Layout helpers (render, view, fillTemplate)
    ├── file-hash.ts                SHA-256 over a Buffer
    ├── seed.ts                     100 synthetic agencies + 1 fake upload row
    ├── seed-data.ts                Names, states, license distributions
    ├── seed-history.ts             90-day backdated signals + surface_history
    ├── seed-sheet-tabs.ts          4 historical date tabs
    ├── agency-type.ts              Service-type inference (synonym map + name keywords)
    ├── icp.ts                      Two-stage ICP rule engine
    ├── csv-parse.ts                csv-parse wrapper (UTF-8 + BOM + comma)
    ├── header-map.ts               Column synonym map; minimum required = company_name + company_url
    ├── upload-pipeline.ts          Validate → bucket → ICP-classify → write draft
    ├── upload-commit.ts            Bucketed UPSERT + auto-enrich daily_drop
    ├── classifier.ts               Tier scoring + UPSERT daily_drop preserving prior reason
    ├── dedup.ts                    Cooldown + internal-signal bypass + tier-promotion bypass
    ├── narrative.ts                Resolves signal_event_ids → fixture-driven Reason text
    ├── cost-model.ts               Provider per-call constants + cost helpers
    ├── settings.ts                 Typed get/set wrapping the settings table
    ├── dashboard-stats.ts          Read-only queries for /admin
    ├── run-cycle.ts                Demo-button orchestrator
    ├── sheets.ts                   Google Sheets writer (live + dry-run)
    ├── signals/                    Signal generators (1 file per signal type) + orchestrator
    └── fixtures/                   OpenRouter / Serper / ZenRows canned responses + deterministic selector
```

The `settings` table is the single source of truth for runtime config — read by ICP rules, classifier weights, dedup window, lead quotas, signal toggles. The toggle panel writes; everything else reads with a fallback default.

---

## Production swap-in points

The prototype is fixture-driven by design. To go live:

| Swap | What changes |
| --- | --- |
| **OpenRouter (AI)** | Replace `pickReason()` in `src/lib/fixtures/select.ts` with an `await openrouter.chat()` call. Same signature, real text. Cache by `(agency, signal-set)` hash. |
| **Serper (Google Maps)** | Replace `pickSerper()` with a real Serper API call. Used for review-velocity + business-existence lookups during ICP filtration. |
| **ZenRows (scraping)** | Replace `pickZenrows()` with ZenRows `premium_proxy + js_render` calls for website / LinkedIn / Google Ads Transparency. |
| **HubSpot closed deals** | The `hendon_closed_deals` table is currently seeded with 5 fake deals. Swap in a HubSpot API sync to populate from real closed-won deals. |
| **Cron scheduling** | Currently the demo loop is triggered by clicking the dashboard button. Production uses Railway cron to call `runCycle()` daily at the chosen quota pace. |

The whole pipeline (`runCycle()` in `src/lib/run-cycle.ts`) is the production entrypoint — same orchestrator, just with the fixture selectors swapped for real API calls.

---

## How this directory relates to the project root

This is a git **worktree** at `.claude/worktrees/bridge-cse_01J3ZxU9F9ysPcDSVYhmFMbj/`, a separate checkout of the branch `worktree-bridge-cse_01J3ZxU9F9ysPcDSVYhmFMbj`. The project root (`/Users/sajjad/Desktop/Hendon by claude skill/`) is a different checkout of the `main` branch — it has the PRD and depth guide but not the prototype source. To get the source onto `main`, merge the worktree branch into `main`.

`.build-state.md` in this directory tracks every slice with full design notes; it's the project's living history.

---

## Status

All 24 slices shipped. The whole prototype demo runs end-to-end on synthetic data with no external API calls (except the optional live Google Sheet write). See `.build-state.md` for the per-slice changelog.
