# Hendon Signal Agent — Implementation Depth Guide

A practical, plain-English walkthrough of every user story in the PRD. For each one you get: what we're building, how the user flow works step by step, every edge case and error you should plan for, how to test it, and a clear marker telling you where to stop if you're only building the 5-hour prototype.

The point of this document: the PRD tells you the **what** and the **why**. This guide tells you the **how deep** so you don't ship something that breaks the day after handoff.

---

## How to read this guide

Each user story has the same shape:

1. **What we're building (plain English)** — one paragraph, no jargon.
2. **The user flow** — step by step, what actually happens.
3. **Deep-dive: every edge case and error** — the exhaustive list. This is the section you keep open while coding.
4. **Testing in plain English** — what to test and how, written like you'd describe it to a colleague.
5. **🟢 PROTOTYPE STOP LINE** — a clear cut-off telling you exactly what to build for the 5-hour prototype and what to leave for the production build.

---

## The build in one paragraph

Hendon Partners has a list of about 24,000 home care agencies and wants to know which ones are getting close to selling — owners hitting retirement, hiring a general manager, getting a sudden spike of Google reviews, running new ads, and so on. Right now they pay Clay a lot of money to enrich each agency, but Clay can't tell them when an owner's life is changing — only what their data says today. We're replacing that with an agent that quietly cycles through the whole list every three months, watches for those "ready to sell" signals, classifies each lead as Hot, Warm, or Long-term, and drops the prioritized list into a Google Sheet every day. Same data is also exposed via an API so Victor (their outbound lead) can pipe it straight into Instantly. The prototype runs entirely on fake data so Joseph can play with it before any real credentials change hands.

---

# User Story 1 — Build and maintain an ICP-filtered TAM list of home care agencies

## What we're building (plain English)

A way to load Hendon's list of home care agencies into our database, clean it up, and filter it down to only the ones that match their ideal customer profile (Medicaid-primary agencies, plus Medicare agencies in priority states). Joseph will upload this list as a CSV exported from Clay. The system needs to handle messy data, dedupe it, decide what's in scope, and keep history so we never lose anything.

## The user flow

1. Joseph (or someone on the Sagan team) signs into the admin page.
2. Sees the current TAM status — how many agencies are loaded, when the last upload happened, how many passed the ICP filter.
3. Drags in a CSV file exported from Clay.
4. The system validates the file before doing anything destructive.
5. Shows a preview: "This file has 24,103 rows. 19,847 will pass your ICP filter. 47 rows have errors — here's why."
6. Joseph confirms or cancels.
7. On confirm: data is written to Postgres, ICP filter is applied, audit log is created, Joseph gets a summary email.
8. On the dashboard, the new TAM stats show up immediately.

## Deep-dive: every edge case and error

### Pre-upload (the page itself)

- Decide who can upload. For prototype, just the Sagan team. For production, Joseph and Victor too — protect the page with a magic link or shared password.
- Show last upload metadata clearly: timestamp, who uploaded, filename, row count, how many passed the ICP filter, how many had errors.
- Provide a downloadable CSV template with every column the system recognizes, and one sample row filled in.
- State the rules upfront: max file size, what columns are required, what columns are optional, what gets ignored.
- Drag-and-drop plus a file picker. Disable the submit button until a file is actually selected.
- Before processing, ask the user how to handle conflicts: "Add new agencies only," "Replace everything," or "Update existing and add new."
- Hash the file. If the same file is uploaded twice, detect it and ask the user before reprocessing — saves them from accidentally overwriting their own work.

### File-level validation (before parsing)

- Check the file extension is `.csv` or `.tsv`. If they upload `.xlsx`, either convert it for them with SheetJS (friendly) or reject with a clear "convert to CSV first" message (simple).
- Check MIME type, but don't rely on it — browsers lie about MIME types all the time.
- Cap file size at 100MB. A real Clay export of 24K agencies should be 10–25MB; anything bigger is suspicious.
- Reject empty files (zero bytes, or zero data rows after the header).
- Look at the first 4KB for null bytes — if you find them, it's probably a binary file pretending to be CSV.
- Detect the file's encoding. Clay exports show up in UTF-8, UTF-8 with a byte-order mark, sometimes Latin-1 or Windows-1252. Strip the BOM if you see one.
- Detect line endings: `\r\n` (Windows), `\n` (Unix), and rarely `\r` (old Mac). Normalize them all to one style before parsing.
- Process the file as a stream — don't load the entire thing into memory. 24K rows is fine in memory, but if Joseph later sends a 200K-row file you'll crash.

### Parsing the CSV

- Detect the delimiter automatically — comma, semicolon (common in European exports), tab, or pipe. Don't hard-code "comma."
- Handle quoted fields properly: double-quote, single-quote, or no quotes at all.
- Handle escaped quotes inside fields (the standard `""` for a literal quote).
- Handle multi-line cells — addresses sometimes have embedded newlines inside quotes, and naive parsers break on those.
- Handle inconsistent column counts per row. Don't silently drop columns when a row is short or long. Flag it.
- Skip blank lines and trailing commas without blowing up.
- Detect whether the first row is headers or data. Some Clay exports have a metadata row above the headers — be ready for that.

### Mapping headers to your schema

- Normalize every header: lowercase, trim whitespace, collapse repeated spaces, strip punctuation.
- Build a synonym map. "Business Name," "Company," "Agency," and "Org Name" should all map to your internal `agency_name` column. Build this map by looking at real Clay exports, not by guessing.
- Required minimum: agency name, AND either state or address. If either is missing, reject the upload with a clear message.
- Recommended but optional: domain, phone, owner name, license type. Warn if missing but allow.
- Unknown columns: don't drop them. Save them in a `metadata` JSON column on the agency record. Clay sometimes has tags Hendon relies on, and you don't want to be the reason they got lost.
- Duplicate column names in the same file: reject with a clear error. Last-one-wins is too dangerous.
- Match headers case-insensitively.

### Validating each row of data

- **Agency name**: must not be empty. Trim. Cap at 255 characters. Strip control characters. Normalize Unicode (NFC form). Watch for test rows ("test," "asdf," "DELETE THIS") — flag for review, don't silently delete.
- **State**: accept "NY," "New York," "N.Y.," "new york." Normalize to the two-letter code. Validate against the 50 states + DC + territories. Reject foreign states with a clear error.
- **Country**: filter to US only — Hendon doesn't operate elsewhere.
- **Address**: parse into street, city, state, ZIP. Use a library like `libpostal`, or just regex out the ZIP. Don't fail the upload if the address is messy — store both the raw and parsed versions.
- **ZIP code**: handle 5-digit and ZIP+4. Watch for leading zeros — Excel destroys these. `"02134"` in quotes and `2134` as a number should both end up as `02134`.
- **Phone**: normalize to E.164 format (`+15551234567`). Strip extensions to a separate field. Reject obviously fake numbers (any 555-0100 range, all-same-digit numbers like `5555555555`).
- **Email**: do basic format validation. Lowercase it. Strip `mailto:`. Don't do a real MX lookup at upload time — too slow.
- **Website / domain**: prepend `https://` if missing. Lowercase the host. Strip the leading `www.`. Strip trailing slashes. Drop query strings. Validate the domain shape, but don't actually fetch the URL.
- **Owner name**: split into first / last / suffix. Handle "John Smith Jr.," "Dr. Jane Doe," and "Smith, John" (last-name-first format).
- **Owner age**: must be numeric and between 18 and 110. If a date-of-birth column is present too, prefer the DOB. Flag impossible values like 5 or 250.
- **License type**: map every variant to a known enum: `medicaid`, `medicare`, `private_pay`, `unknown`, or `mixed`. Default to `unknown` — never silently default to a real value.
- **Booleans**: accept Y/N, yes/no, 1/0, true/false, T/F.
- **Numbers with commas or currency symbols**: strip `$` and `,` before parsing.
- **Dates**: accept ISO 8601 (`2025-04-16`), the US format (`04/16/2025`), and Clay's preferred format. Reject ambiguous dates like `03/04/2025` (which could be either US or UK) — require an unambiguous source or document the assumed format prominently.

### Deduplicating within the same upload

- Exact row duplicates: collapse silently.
- Same domain → same agency. Domain is the strongest natural key.
- Same name + same ZIP → likely a duplicate. Use fuzzy matching (rapidfuzz or trigram similarity) at a similarity threshold above 0.9.
- Same phone number → flag, but don't auto-merge. Phones get reused.
- When fields conflict between two duplicate rows, you need a deterministic winner rule. Two reasonable choices: longest non-empty value wins, or last row in the file wins. Pick one and document it.

### Cross-referencing with what's already in the database

- For each row in the upload, check if it matches an existing agency. Match by domain first, then name + ZIP, then name + state.
- Sort the results into three buckets: NEW (insert), EXISTING (update), and MISSING-FROM-UPLOAD (in the database but not in this file).
- For EXISTING agencies, decide carefully which fields the upload is allowed to update. Always update `last_seen_in_upload`. Update contact info (phone, email, owner name) safely. **Never** let the upload overwrite signal history, tier history, or surface history — those belong to the agent, not the CSV.
- For MISSING-FROM-UPLOAD: do not delete. Mark the agency as `tam_status = 'inactive'` and preserve everything. Joseph might be uploading a smaller subset by mistake, and you can never get a closed-deal history back.
- Soft-delete only, ever. The "we sold Bob's in Cleveland" record has to survive any TAM operation.
- Save a `tam_version` per agency so you can answer the question "what was in the TAM the day we generated yesterday's drop?"

### Applying the ICP filter

- The state priority list determines geographic scope: agency is in scope only if its state is in the priority list. Keep this list configurable in the database, not hardcoded.
- The license-type rule: include if `medicaid`. Include if `medicare` AND the state is in the Medicare priority sub-list. Exclude if `private_pay` only.
- For unknowns: default to `in_review` rather than excluded. Joseph reviews them and decides.
- Apply the ICP filter at query time, not at write time. Store everything; tag each agency with an `is_icp` flag that gets recomputed when the rules change. If you filter at write time you lose data permanently when Joseph tightens the rules later.

### Writing to the database

- Wrap the entire upload in a database transaction. Either everything writes successfully, or nothing does.
- Insert in batches of 500–1000 rows. A single 24K-row insert works in Postgres but it's harder to retry on partial failures.
- Use UPSERT on the natural key: `ON CONFLICT (domain) DO UPDATE`.
- Make sure you have indexes on `domain`, `state`, name (with trigram for fuzzy matching), `is_icp`, and `tam_status`.
- Write an audit log entry per upload: file hash, row counts, ICP counts, error counts, who uploaded, how long it took.
- Stamp every agency record with its provenance: `source = 'upload:<upload_id>'`. That way you can always trace any agency back to the file that introduced it.

### Errors and partial failures

- Distinguish between row-level errors (one bad ZIP, one missing name) and file-level errors (the whole file is the wrong encoding).
- For row-level errors: collect them, don't stop the whole upload. At the end, show counts grouped by error type.
- Generate a downloadable error CSV — original row plus the error reason. Joseph fixes those rows in his copy and re-uploads only the bad ones.
- At the summary screen, let the user choose: "Commit the valid rows" or "Cancel and fix everything."
- For file-level errors: stop, roll back, show a clear message. Never half-import.
- Common error buckets to report on: missing required column, duplicate domain within the file, invalid state, foreign address, malformed phone, parse failure on a specific row.

### Security

- CSV injection: any cell whose value starts with `=`, `+`, `-`, `@`, tab, or carriage return will be executed as a formula when someone opens the file in Sheets or Excel. Sanitize at write-time when you push to Google Sheets by prefixing the value with a single quote `'`. Don't sanitize at upload time — you may want to keep the raw value internally.
- Path traversal in the original filename: store the file under a UUID, never under the user's filename.
- Don't render raw cell content into the admin HTML page without escaping.
- PII (owner names, phone numbers, emails): encrypt the database at rest, restrict who can access it, log every export.
- Auto-delete raw uploaded files after 30 days. Keep the parsed normalized data in the database, but the source file doesn't need to live forever.
- Rate-limit the upload endpoint — only one upload at a time per user.

### Performance and timeouts

- Upload + parse + ICP filter for 24K rows should finish in well under 60 seconds. If it's slower, make it asynchronous: accept the upload, return a job ID, process in a background worker, show progress on the dashboard.
- Don't hold an HTTP request open for minutes. Railway will kill it.
- Stream the parser. Don't read the whole file into memory.
- Cap memory on the worker. Refuse files that would exceed it.

### Observability

- Log every upload with: file hash, file size, row counts in and out, ICP pass and fail counts, error counts, duration in seconds, who uploaded.
- Track metrics: total uploads, upload errors, current TAM size in rows.
- Send Slack or email notification to the Sagan team on completion or failure.
- Show the last 10 uploads on the admin dashboard with their summaries.

### Post-upload behavior

- **Do not** automatically trigger the daily Sheet drop after an upload. Joseph might upload at 2am.
- Reset the cycle pointer? Optional — give the operator a checkbox: "Restart cycle from agency 0."
- Recompute `is_icp` for every agency if the upload changed any ICP rules.
- Email Joseph: "Your TAM upload processed. 24,103 rows in. 19,847 in ICP. 47 errors — download the error report here."
- Snapshot the previous TAM state before applying the new upload. If something goes wrong, you can revert.

### Recovery and rollback

- Build an "Undo last upload" button that restores the previous snapshot. Especially useful in the first month while Joseph is calibrating the ICP rules.
- Soft-delete window: a row marked inactive isn't actually deleted from the database for 90 days.
- Manual export of the current TAM as CSV. Lets Joseph audit what's actually in there versus what he thinks he uploaded.

### Hendon-specific edge cases

- Clay's export sometimes includes "Closed Won" rows for deals already closed. Those should not enter the TAM. Detect them by their tag.
- Visiting Angels and BrightStar Care are franchises — every location is its own agency, all sharing a parent brand. Don't dedupe by name alone.
- DBA names versus legal entity names: Clay sometimes has both columns. Decide which one is canonical.
- Hendon's recently-closed agencies should be auto-excluded. Once HubSpot is wired up, cross-reference with closed-won deals. For prototype, accept an "exclude list" CSV alongside the TAM.
- Test rows from Clay (Joseph experimenting): flag any row where the name contains "test," "demo," "asdf," or where the domain is `example.com` or `test.com`.

## Testing in plain English

- **The basics**: Upload a clean CSV with 100 well-formatted rows. Verify all 100 land in the database. Verify the ICP filter result count matches your expectation.
- **Encoding tests**: Save the same file as UTF-8, UTF-8 with BOM, Latin-1, and Windows-1252. Upload each. Verify they all parse identically.
- **Delimiter tests**: Save the same data with commas, semicolons, tabs, and pipes. Upload each. They should all work.
- **Junk rows**: Inject rows with embedded newlines, escaped quotes, weird Unicode, leading/trailing whitespace. Verify the parser handles them and doesn't break the upload.
- **Missing columns**: Upload a file missing the agency name column. The system should reject it with a clear error.
- **Bad data**: Upload a file with malformed phone numbers, fake states, impossible owner ages. The system should flag these as row-level errors and let the user decide whether to commit the rest.
- **Duplicates**: Build a CSV with duplicate domains. Verify the dedup logic collapses them and reports what it did.
- **Conflicts with existing data**: Upload one file. Then upload a second file that overlaps with the first. Verify each conflict-resolution mode (add only, replace, update + add) produces the right outcome.
- **The same file uploaded twice**: Upload the exact same file. Verify the system detects the hash match and asks before reprocessing.
- **Big file**: Upload a real 24K-row Clay export. Time it. Confirm under 60 seconds end to end. If not, move to async processing.
- **Rollback**: Upload a bad file by mistake. Use the undo button. Verify the database returns to its previous state.
- **CSV injection**: Inject a cell that starts with `=cmd|...`. Verify the cell is sanitized when it gets written to Google Sheets later.
- **Foreign rows**: Upload a CSV with a few non-US addresses. Verify they're flagged.
- **Test rows**: Upload a file with rows where name = "test." Verify the system flags them, doesn't silently keep them.
- **The error report**: Force a few row-level errors and verify the downloadable error CSV is correct and re-uploadable.

## 🟢 PROTOTYPE STOP LINE — User Story 1

For the 5-hour prototype, you are running on synthetic data. **You can skip the entire CSV upload flow.** Generate ~100 fake agencies in code with the right shape (name, state, owner age, license type, etc.) and write them straight to SQLite at startup. The customer-facing demo is the Google Sheet, not the upload page.

What you should still build for the prototype:
- The Postgres (or SQLite for prototype) schema for agencies, including the `is_icp` flag, `tam_status`, `metadata` JSON, and provenance fields. Get this right now and the production upload flow plugs in cleanly later.
- A simple "view current TAM" page that shows agency count, ICP-pass count, and a sample of recent agencies. Joseph wants to see the system has data; he doesn't need to upload it himself yet.
- The ICP filter logic, applied at query time, configurable via a settings table. This matters because it affects what shows up in the Sheet drop.

What you should defer to production:
- The entire upload UI and flow.
- All file validation, encoding detection, delimiter detection.
- The synonym mapping for Clay's column names.
- Dedup against existing data.
- Audit log and rollback.
- The error CSV download.

---

# User Story 2 — Monitor each agency on a rolling cycle for sale-readiness signals

## What we're building (plain English)

The heart of the system. Every week, the agent processes about 2,000 agencies — checking their Google Maps reviews, scanning their websites, looking at their LinkedIn activity, watching for new ad campaigns, and so on. Anything that crosses a threshold (owner turning 70, 50 new reviews this month, a "we're hiring a GM" job posting) becomes a signal. Over three months, the whole 24K TAM gets cycled through. The output is a stream of signal events sitting in the database, ready for the classifier to turn into prioritized leads.

## The user flow

1. A scheduled cron job fires every weekday morning.
2. The agent picks up the next batch of agencies — roughly 400 a day, weighted by ICP priority.
3. For each agency, it runs a series of signal checks: Google Maps review scrape, LinkedIn profile scrape, website diff, ad library check, internal closed-deal proximity check.
4. Each check returns either "no signal," "weak signal," or "strong signal" with details.
5. Signals are written to a `signal_events` table with full provenance — what source, what value, when checked.
6. Cost and rate limits are tracked per source, per cycle, per agency.
7. Errors are logged but don't crash the cycle — one flaky source shouldn't take down the run.

## Deep-dive: every edge case and error

### Cycle scheduling and pacing

- Use Railway's cron, not n8n's scheduler. The PRD is explicit on this.
- Target throughput: roughly 2,000 agencies per week, which is ~400 per weekday. Don't run on weekends — too easy to set off scraping defenses when traffic is unusually low.
- Within a day, spread checks out across hours. Don't fire 400 agencies' worth of requests in one minute.
- Maintain a cycle pointer in the database — which agency was last processed, what cycle number you're in, when the cycle started.
- Handle cycle restarts cleanly: if a cycle is interrupted (deploy, crash, manual stop), the next run picks up where it left off, not at agency 0.
- Decide what "priority" means inside a cycle. Always put ICP-pass agencies ahead of out-of-ICP agencies. Always put agencies that haven't been checked in 90+ days ahead of recently-checked ones.

### Per-source rate limiting and budgets

- Every external source (Serper, ZenRows, OpenRouter) has a per-second and per-day rate limit. Track requests in a sliding window and back off before the provider does.
- Set a per-cycle cost cap. Below the cap, run normally. At 80% of cap, alert. At 100%, pause the cycle and email the team.
- Set a per-agency cost cap. No single agency check should cost more than $0.10 in API calls. If it would, log it and skip that signal type for that agency.
- Set a per-source error budget. If Google Maps is failing for 30% of agencies in a row, pause that signal type and alert. Don't let one broken source eat your entire cost cap on retries.

### Signal: owner age

- Source: LinkedIn profile graduation year, used as a proxy. If we see "MBA, Stanford, 1978," that owner is probably 65+.
- Be honest in the Reason line. Write "Owner appears 65+ based on LinkedIn graduation year" — never "Owner is 67."
- Coverage problem: the PRD says less than 50% of owners have LinkedIn profiles, and most are inactive. Design for the missing case. No LinkedIn ≠ no signal — it just means you can't fire this particular check.
- Don't infer age from photos. Brittle and creepy.
- If multiple potential owners exist (multi-owner agency), pick the one with the highest probability of being the principal — usually the founder or longest-tenured.
- Edge case: graduation year missing but other date markers (first job, "celebrating 30 years in business") give an estimate. Document the inference logic.

### Signal: hiring a general manager

- Sources: agency website ("careers" page or "about" page), LinkedIn job postings, sometimes Indeed.
- Look for job titles like "General Manager," "Operations Manager," "Director of Operations," "Executive Director." Don't trigger on "Caregiver Manager" or "Care Coordinator" — wrong level.
- Watch for first-time GM hires especially. An agency that's never had a GM and is now hiring one is a very strong signal — the owner is preparing the business to run without them.
- Caveat: large multi-location agencies hire managers all the time. Apply this signal more carefully to single-location agencies.
- Avoid duplicate signals: if the same job posting is on the website AND LinkedIn AND Indeed, count it once.

### Signal: Google review count and velocity

- Source: Google Maps via Serper.
- Fetch review count and the date of the most recent few reviews. Compare against the same agency's last reading.
- "Velocity spike" definition: more than 30% increase in monthly review rate compared to the trailing six months. Configurable.
- Edge case: a brand new agency with 5 total reviews going to 7 is technically a 40% increase — but it's noise. Apply a minimum-baseline filter (say, 20+ reviews before velocity matters).
- Beware fake review attacks: 50 reviews in a single day is more likely fraud than growth. Flag, don't fire as a signal.
- Source unavailable: if Serper times out for a specific agency, retry once with backoff. Then skip and log. Don't burn the cycle on retries.

### Signal: ad activity changes

- Sources: Google Ads Transparency Center is the most accessible. Facebook Ads Library is secondary.
- Compare ad volume against the agency's previous reading. The example from the call: going from 4 ads to 50 likely means they hired an ad agency, which tracks with growth or sale prep.
- Both transparency centers change their HTML structure regularly. Plan to revisit selectors monthly.
- Edge case: an agency might run ads under a different brand name, or under the owner's personal name. Don't expect 100% match rate.
- Some agencies legitimately run zero ads forever. Absence of ads isn't a signal in either direction.

### Signal: website changes

- Source: scrape the agency's website weekly, store a hash of the visible content per page.
- Watch for: new pages appearing (new service offerings), new "about us" content (new GM, new owner), new careers postings, sudden refresh of the site (often a precursor to listing).
- Distinguish between meaningful changes and noise. CSS tweaks, copyright year updates, new blog posts — not signals. New services pages, new staff bios, new careers section — signals.
- Use a lightweight AI call to interpret diffs. Lightweight tier is appropriate; Reach for SoTA only if a specific case proves it needs more.
- Edge cases: site behind Cloudflare with bot protection, JS-rendered content, sites that redirect everything to a Facebook page.
- Some agencies don't have websites at all, or have a one-page Wix site that never changes. Handle gracefully.

### Signal: LinkedIn activity

- Source: scrape the owner's LinkedIn profile if known. Look for recent posts (M&A engagement, retirement-adjacent content, "looking for next chapter" framing).
- Coverage is partial — Joseph said under 50% have profiles, most inactive. Don't fail loud when there's no profile to check.
- LinkedIn aggressively rate-limits scraping. Rotate proxies via ZenRows, throttle hard, accept that you'll miss some.
- Never log into a real LinkedIn account from the agent. That's a permanent ban risk.

### Signal: nearby Hendon closed deal (internal signal)

- Source: HubSpot API for Hendon's recently closed-won deals. For prototype, a static list of fake deals.
- Trigger: when a new closed-won deal is added in HubSpot, find all agencies within ~25 miles of that deal's address. Promote them as "nearby closed deal" signals.
- This is an internal signal, which means it should override the dedup cooldown. If a Long-term lead suddenly has a Hendon deal close down the street, surface them again immediately even if they were just surfaced two weeks ago.
- Decay: the signal weakens over time. A deal that closed last week is hotter than one that closed eight months ago.
- Coordinate with Joseph on what counts as "nearby" — 25 miles in NYC means something different than 25 miles in rural Texas. Probably weight by metro density.

### Storing signal events

- Schema: `signal_events` table with `agency_id`, `signal_type`, `signal_strength` (weak/strong), `value` (e.g., review count, owner age estimate), `source`, `checked_at`, `evidence_url`, `evidence_snippet`.
- Always store evidence — the URL and a snippet of text — so you can audit later or show it to Joseph if he asks "why did you flag this one?"
- Idempotency: if you re-check the same agency for the same signal an hour later and the value is unchanged, don't write a duplicate event. Update the previous event's `last_seen_at`.
- Index on `agency_id`, `signal_type`, `checked_at` — these queries get hot.

### Errors and degradation

- A single signal check failing should not stop the agency's other checks. Catch errors at the per-signal level.
- A single agency failing entirely (every check errors out) should not stop the cycle. Log it, mark the agency as "needs investigation," move on.
- A whole source going down (Serper down for an hour) should pause that signal type globally and resume when health checks pass.
- Never silently suppress errors. Every failure goes to a structured log, with enough context to reproduce.

### Cost discipline

- Track cost per signal check, per source, per agency, per cycle. Aggregate to the dashboard.
- Project monthly cost based on the current cycle's spend rate. If projected to exceed budget, alert before it happens.
- For Lightweight AI calls, batch where possible. Many signals can be classified together in a single call.
- Cache aggressively. If you scraped this agency's Google Maps page yesterday and the review count hasn't moved, don't re-call OpenRouter to interpret the same data.

### Hendon-specific edge cases

- Multi-location agencies (Visiting Angels franchisees): each location is independent. A signal at one location doesn't necessarily mean anything at another.
- Hospice agencies have different rhythms than home care. Don't assume the same review velocity threshold works for both.
- Some states have different licensing systems and different signals available. State licensing portals vary wildly — design for "best effort" coverage.
- Recently-sold agencies should be filtered out of the cycle entirely. Use HubSpot for the source list.

### Observability

- A run log entry per cycle execution: started at, ended at, agencies processed, signals fired by type, errors by type, total cost.
- Per-agency last-checked timestamp. Lets you spot agencies that aren't getting cycled.
- Per-source health metric. Lets you spot when Google Maps starts failing 50% of requests.
- Slack/email alert on cycle completion with a summary.

## Testing in plain English

- **Mock every external source** during development. Don't actually scrape Google Maps in dev — use recorded fixtures.
- **Per-signal unit tests**: feed each signal detector a known input (mock review counts, mock LinkedIn profiles) and verify the right signal fires with the right strength.
- **Threshold tuning tests**: verify that a 25% review velocity increase doesn't fire (below threshold), 35% does fire, and 200% gets flagged as suspicious rather than triggering.
- **Missing data tests**: test every signal type against an agency with no LinkedIn, no website, no Google Maps presence, and verify the system handles it gracefully.
- **Error injection**: simulate Serper returning a 429 (rate limit). Verify the system backs off and retries. Simulate ZenRows returning malformed HTML. Verify the parser doesn't crash.
- **Cost cap test**: set a low cost cap, run a cycle, verify it stops at the cap and alerts.
- **Cycle resumption test**: kill the cycle mid-run. Restart it. Verify it picks up where it left off, not from the beginning.
- **Internal signal test**: add a fake Hendon closed deal in Cleveland. Verify all agencies within 25 miles of Cleveland get the nearby-deal signal. Verify the signal can override the dedup cooldown.
- **End-to-end smoke test**: process 10 real agencies (with permission) and manually verify the signals look correct.

## 🟢 PROTOTYPE STOP LINE — User Story 2

For the 5-hour prototype, **you do not scrape anything real**. The PRD says the prototype runs on synthetic data, period. Every signal is generated by a fake signal generator that produces realistic-looking events at the percentages the PRD specifies (15% owner 70+, 10% hiring GM, 20% review spike, 10% ad campaign jump, 5% nearby Hendon closed deal).

What you should build for the prototype:
- The signal generator code, with the right mix of signal types and strengths.
- The `signal_events` table with full schema, including evidence snippets (which can be templated narratives like "Owner profile shows 1972 graduation year").
- Pre-generate roughly 90 days of historical signal events so the dedup logic and the "Long-term re-surface every 6 months" floor have data to work with at demo time.
- A static list of 5 fake "Hendon recently closed deals" that drive the nearby-deal signal logic.
- The cost projection on the dashboard can be a static estimate — no live tracking required.

What you should defer to production:
- All real scraping (ZenRows, Serper).
- Rate limiting and per-source health monitoring.
- Real LinkedIn coverage handling.
- Real cost tracking against API providers.
- HubSpot integration for closed deals.
- All of the source-specific edge cases (Cloudflare, JS rendering, captcha handling, etc.).

---

# User Story 3 — Classify each lead into Hot, Warm, Long-term and dedupe

## What we're building (plain English)

The classifier sits between the raw signal events and the daily Sheet drop. It looks at every agency's signal history, applies Hendon's tiering rules, decides which agencies to surface today, and makes sure no one gets bothered too often. The output is a list of "today's leads" with a tier assigned to each.

## The user flow

1. The classifier runs once per day, after the cycle has had a chance to add new signals.
2. It pulls every agency that has at least one new signal since the last classification run.
3. For each agency, it applies the tiering rules (Hot / Warm / Long-term) using the current rule weights from the database.
4. It checks the surface history: has this agency been surfaced in the last two months? Was it a Long-term lead that's now Hot (override allowed)?
5. It writes the new tier classification to a `tier_history` table.
6. It writes the surfaced leads to a `daily_drop` table — that's what the Sheet writer reads from.
7. Surface history is updated so the dedup window starts again.

## Deep-dive: every edge case and error

### Tiering rules

- The rules from Jon's "more wood behind fewer arrows" framework: Hot is multiple signals or one very strong one (owner 70+ AND hiring a GM); Warm is a single signal or growth indicator; Long-term is no signals fired but the agency should still get touched every six months.
- Store the rule weights in a Postgres table, not hardcoded. Joseph and Jon both flagged that the rules will need tuning as Hendon learns what actually predicts deals.
- Each signal type has a weight. Each tier has a threshold. Hot ≥ 80, Warm ≥ 30, Long-term < 30 (with the 6-month floor).
- Allow combination bonuses: "owner 70+ AND hiring GM" is worth more than the sum of those two signals individually. Encode this as a separate rules table — combo_bonuses.
- Allow source-trust adjustments: a signal from Google Maps reviews is high-trust; a signal inferred from an indirect website mention is lower-trust. Apply a confidence multiplier.

### The 6-month Long-term floor

- Every agency that hasn't been surfaced in 6 months should get surfaced as a Long-term lead — even if no signals fired.
- This is a separate query path from the signal-driven classification. Run it daily.
- Spread the 6-month surfacing across the calendar so you don't dump 4,000 Long-term leads on one day. Distribute by `last_surfaced_at + 180 days`.
- Long-term leads still need a Reason line, but it's different — "Hasn't been contacted in 6 months. Educational outreach window." Keep it honest.

### Dedup rules

- Default cooldown: 60 days. Once an agency is surfaced, don't surface it again for 60 days.
- Override 1: a Long-term lead suddenly becomes Hot (multiple new signals fire). The cooldown is bypassed and the agency is surfaced as Hot.
- Override 2: an internal signal fires (nearby Hendon closed deal). The cooldown is bypassed.
- Override 3: a manual override by the operator ("force-surface this agency next run"). Edge case but needed for production.
- Track the override reason in the `surface_history` table — useful for tuning later.

### Tier promotion and demotion

- An agency can change tiers between runs. Today they were Warm, tomorrow a second signal fires and they're Hot.
- Always re-classify on every run — don't trust the previous classification. Signal events have lifespans (a review velocity spike from 6 months ago doesn't count anymore).
- When an agency moves from Warm to Hot or from Long-term to Hot, log it as a `tier_promoted` event so you can see promotion patterns later.
- Demotions matter too. If an agency was Hot last month but the signals have aged out, they should drop back to Warm or Long-term.

### Signal aging

- Each signal type has a lifespan. Review velocity spike: 90 days. New ad campaign: 60 days. Hiring a GM: 120 days. Nearby Hendon closed deal: 180 days. Owner age: never expires.
- After the lifespan, the signal stops contributing to the tier score. It still lives in the database — just stops counting.
- Make lifespans configurable per signal type.

### The "why" explanation

- Every surfaced lead must have a Reason (one line) and a Key Signals breakdown (multi-line). These are both human-readable and go straight into the Google Sheet.
- The Reason is generated when the lead is surfaced. Use a Lightweight AI model with a tight prompt: "Given these signals, write one sentence explaining why this is a Hot lead. Be specific. Cite the strongest signal."
- Cache reasons. If the same agency is surfaced again with the same signals, reuse the cached Reason. Don't burn an API call every time.
- Templates can fill in for common cases: "Owner appears 70+ AND agency posted GM hiring on [date]" — no AI needed.

### Conflict resolution

- An agency could match multiple Hot criteria simultaneously (owner age AND hiring AND ad campaign jump). Don't list all of them — pick the strongest two and lead with those.
- An agency could be in conflict with itself: signals say Hot, but the operator has a manual "do not contact" flag. Manual flags always win. Surface the agency to the operator's review queue, not to the Sheet.
- Two agencies that are actually the same business (slipped through dedup at upload time) — handle this by domain match at classification time. Surface only one.

### Edge cases

- An agency with one very strong signal and no historical data: trust the signal but mark it as `confidence: medium` rather than `high`.
- An agency that was Hot last cycle but had every signal age out: demote to Long-term and surface in the 6-month rotation, not as Hot again.
- An agency that fires the "nearby Hendon closed deal" signal but is itself in the closed-deal pipeline (Hendon is selling them): exclude from the surface — would be embarrassing.
- An agency that's been marked do-not-contact: never surface, period. But still cycle for signals — Hendon may want to know if something dramatic changes.

### Storing classification results

- `tier_history` table: one row per (agency, run, tier). Lets you look at any agency's tier journey over time.
- `daily_drop` table: one row per (date, agency, tier, reason, key_signals). This is what the Sheet writer reads.
- `surface_history` table: every time an agency is surfaced, one row. Includes the cooldown window, override reason if any, and which tier they were in.
- All three should be append-only. Never UPDATE or DELETE in normal operation.

### Observability

- Daily classification summary: how many leads in each tier, how many were promoted, how many were Long-term floor surfaces, how many were dedup-blocked.
- Per-rule firing rate: which signals are actually driving Hot classifications? If review velocity is firing 80% of Hot leads, something's miscalibrated.
- Per-agency tier history view on the admin dashboard.

## Testing in plain English

- **Rule unit tests**: feed the classifier a synthetic agency with known signals and verify the tier comes out correct. Build a comprehensive set: only owner 70 → Warm, owner 70 + hiring GM → Hot, no signals + last surfaced 7 months ago → Long-term, nearby Hendon deal in any state → Hot regardless.
- **Cooldown tests**: surface an agency. Try to surface it again the next day. Verify it's blocked. Try to surface it 65 days later. Verify it goes through.
- **Override tests**: surface an agency as Warm. Then add an internal signal (nearby Hendon deal). Verify the agency surfaces again immediately, even within the cooldown window.
- **Promotion test**: classify an agency as Long-term. Then add three new signals. Run the classifier again. Verify the agency is now Hot and a `tier_promoted` event is logged.
- **Demotion test**: classify an agency as Hot. Wait until the underlying signals age out. Run the classifier. Verify the agency drops to Warm or Long-term.
- **Long-term floor test**: configure 100 agencies with no recent surface. Run the classifier. Verify roughly 100/180 agencies surface today (the 6-month rotation).
- **Reason quality**: spot-check 20 generated reasons. They should be specific, accurate, and human-readable. No "this lead matched the criteria" filler.
- **Performance test**: with 24K agencies in the database and 50K signal events, the daily classifier should run in under 30 seconds.
- **Idempotency**: run the classifier twice on the same day. Verify the results are identical and no duplicate `daily_drop` rows are created.

## 🟢 PROTOTYPE STOP LINE — User Story 3

For the 5-hour prototype, build the classifier in full but on synthetic data. The classifier is what makes the demo feel intelligent — Joseph needs to see "this lead is Hot because owner is 70 AND they posted a GM job" and immediately understand why.

What you should build for the prototype:
- The full tier rule engine with configurable weights in a SQLite settings table.
- The 60-day dedup cooldown logic.
- The internal-signal override that bypasses cooldown.
- The 6-month Long-term floor (you can simulate this by pre-seeding "last_surfaced_at" dates so different agencies surface on different days).
- Reason and Key Signals generation. Use a Lightweight AI call once per surfaced lead, cache the result. Pre-generate during seeding to keep the demo runtime fast.
- Tier promotion logging.

What you should defer to production:
- Manual operator overrides ("force surface this agency").
- Per-rule firing rate analytics.
- Confidence multipliers based on source trust.
- Demotion logging (just re-classify cleanly each run).
- Aged-out signal handling — for prototype, all synthetic signals are fresh.
- Manual do-not-contact flag (you can include the schema field but no UI to set it).

---

# User Story 4 — Daily Google Sheet drop in the gym-leads format

## What we're building (plain English)

Every day, the system writes today's surfaced leads to a Google Sheet in Joseph's workspace. The Sheet looks exactly like the gym-leads example Zaki demoed on the call — same columns, same date tabs at the bottom, same color coding. Hot leads are highlighted, do-not-contact rows are red. Joseph and Victor open the Sheet and immediately know what to act on.

## The user flow

1. After the classifier runs, the Sheet writer kicks off.
2. It reads today's `daily_drop` rows from the database.
3. It connects to the Google Sheet via the Sheets API.
4. It creates a new tab named with today's date (e.g., "05/06").
5. It writes the header row, then writes each lead as a data row in the gym-leads column order.
6. It applies formatting: header styling, color coding for tiers, freeze panes, column widths, multi-line cells for Key Signals.
7. It updates a "Latest" tab that always shows the most recent drop.
8. Older tabs are preserved for history.
9. On success, it logs the run and notifies Victor.

## Deep-dive: every edge case and error

### Sheet structure

- Match the gym-leads layout exactly. Columns in this order: Created, HubSpot Link, Company, Domain, Reason, Address, City, State, ZIP, Segment, Current Stack, Phone, Instagram, Facebook, LinkedIn, Email, People (owner/principal), Key Signals, Country, Priority Tier, Notes, Salesperson.
- Reference screenshots `1_30m00s.jpg` through `63_32m04s.jpg`. Pull the actual column widths and styling from there.
- Freeze the header row.
- Set column widths to comfortable defaults — wide enough for 60-character agency names, narrow enough for 2-letter state codes.
- Wrap text in the Key Signals column. That's the one with multi-line content.

### Date tabs

- One tab per daily drop, named like the gym example (`10/09`, `10/10`, `10/13`).
- Skip weekends in the naming if the cron skips weekends.
- A "Latest" tab pinned to the leftmost position that always mirrors the most recent drop.
- A "Summary" tab at the front that shows totals across all dates: total Hot, total Warm, total Long-term, last 7 days trend.
- Old tabs stay forever. Don't auto-prune. Joseph might want to look at last quarter.

### Color coding

- Hot rows: tinted background (light orange or warm yellow). Prominent.
- Warm rows: neutral background.
- Long-term rows: distinct subtle background (light blue or grey). Visible but not loud.
- Do-not-contact rows: red highlight on the entire row (matches the gym example screenshots `1_30m00s.jpg` and `60_31m58s.jpg`).
- Completed outreach rows: green or strikethrough — coordinate with Victor on the convention.
- Use Sheets' "conditional formatting" if you want it to update automatically when Notes column changes; otherwise apply directly when writing.

### Multi-line Key Signals cell

- The Key Signals column holds multiple lines per cell. Match the gym example's structure: company description, location, timezone, segment, list of signals fired, lookalike if applicable.
- Use `\n` inside the cell value. Sheets renders it as multi-line when text wrapping is on.
- Cap line count to ~10 per cell. If a lead has more, truncate and add "and 3 more signals" — Sheets cells get unwieldy past that.

### Writing to the Sheet

- Use the Google Sheets API directly with `googleapis` npm package. n8n is fine for production (per the PRD), but for prototype, direct API is faster.
- Authentication: service account JSON file. Share the target Sheet with the service account's email address.
- Use `batchUpdate` for writes — much faster than per-cell writes, and avoids hitting the API rate limits.
- Apply formatting in the same `batchUpdate` call as the data write. Don't write data, then come back later for formatting — race condition risk.
- Write to a new tab atomically. If anything fails partway through, delete the partial tab and retry.

### CSV injection prevention

- Any cell starting with `=`, `+`, `-`, `@`, tab, or carriage return will execute as a formula in Sheets. This is a real risk — agency names or notes could contain these characters.
- Sanitize at write time. If a cell value starts with one of these characters, prefix it with a single quote `'`. Sheets treats `'=foo` as a literal string.
- Always sanitize. Even data you "trust" — owner names with leading hyphens (`-Smith`) are common.

### Sheet permissions

- Coordinate with Victor on workspace ownership. The gym example was clearly in the customer's Google Workspace.
- For Hendon: ask Joseph whether the Sheet should live in Hendon's workspace (so Victor and the calling team can edit notes and disposition) or in Sagan's workspace with shared edit access.
- Either way, the service account writing to the Sheet needs editor access. The team needs editor access too — they'll annotate the Notes column.
- Never expose the service account credentials in the Sheet. Don't log credentials. Don't commit them.

### Rate limits and retries

- Google Sheets API limits: 60 requests per minute per user, 300 per minute per project. Batch writes count as one request regardless of cell count, so this is rarely hit at our volumes.
- On 429 (rate limit) or 5xx errors: exponential backoff, retry up to 3 times.
- On 403 (permission) or 404 (not found): don't retry. Alert immediately.
- If the Sheet is open in a browser when you write, it works fine — Google handles concurrent edits.

### Edge cases

- Empty drop day: today the classifier surfaced zero leads. Still create the tab; show a single row "No new leads today." Don't skip the tab — silence reads as a broken system.
- Re-running the same day: don't double-write. Either replace the existing tab or refuse and require a manual override.
- Sheet is full (Sheets has a 10 million cell limit): in practice, we'll never hit this. But if we do, the system should detect it and email rather than silently fail.
- Joseph deletes a tab manually: leave it. Don't auto-recreate.
- Joseph renames a tab: leave it. Use tab IDs internally, not names.
- Sheet is moved to a different folder: works fine, the API uses the Sheet ID, not the path.
- Sheet is deleted: panic gracefully. Email the team. Don't recreate the Sheet automatically — Joseph might have meant to delete it.

### Output format details from the screenshots

- The gym example uses specific phrasings for the Reason column: "Closed Won LookAlike," "Trial ReConverts," "Hot Leads [FAA]." Adapt for Hendon's signals: "Owner Retirement Signal," "Sale Prep Signal," "Nearby Hendon Deal," "Long-Term Touch."
- Lookalike phrasing: when an agency resembles a previously-closed Hendon deal in segment + size + location, include "Closed Won LookAlike of [previous deal name]" in Key Signals.
- The Salesperson column is initially blank — Victor or the calling team fills it in when they pick up the lead.
- The Notes column is a free-text field for Victor's annotations. Don't write anything to it from the agent.

### Performance

- A daily drop of 100–300 leads writes in under 5 seconds with `batchUpdate`. Stay well within rate limits.
- For prototype with 50–80 leads in a drop, this is essentially instant.

### Observability

- Log every Sheet write: tab name, row count, duration, success/failure.
- Email Victor on success: "Today's drop is live. 23 Hot, 47 Warm, 12 Long-term."
- On failure: alert the Sagan team, do not alert Victor (we don't want to surface our own failures to the customer).

## Testing in plain English

- **End-to-end smoke test**: feed the writer a synthetic daily drop. Verify the Sheet has a new tab with the right name, all rows present, formatting applied, color coding correct.
- **Visual diff against the gym example**: open the Sheet side by side with the gym-leads screenshots. Match column order, column widths, header styling, color choices, freeze panes. The PRD says match exactly — this matters for the customer reaction.
- **Multi-line cell test**: write a lead with a 5-line Key Signals value. Verify it renders as multi-line in the Sheet, not as one long line.
- **Color coding test**: write one Hot lead, one Warm, one Long-term, one do-not-contact. Verify each row has the correct background color.
- **CSV injection test**: write a lead whose name is `=cmd|"/c calc"!A1`. Open the Sheet. Verify the cell shows the literal string, not an error or executed formula.
- **Re-run test**: run the writer twice on the same day. Verify the system either refuses or replaces, but doesn't create duplicate tabs.
- **Empty day test**: run the writer with zero leads. Verify the tab is still created with a "no new leads" placeholder row.
- **Rate limit simulation**: throttle the Sheets API, watch the writer back off and retry.
- **Permission test**: revoke the service account's access mid-run. Verify the writer fails clearly with a 403, alerts, doesn't corrupt data.
- **Manual edit preservation**: write today's drop. Manually edit the Notes column on a row. Run tomorrow's drop. Verify the manual edit is preserved (today's tab is untouched).

## 🟢 PROTOTYPE STOP LINE — User Story 4

For the 5-hour prototype, this is the demo. It has to be tight. Joseph approved the gym format by reaction; if your Sheet looks like a generic export, the demo loses force.

What you should build for the prototype:
- A real Google Sheet, hosted on Sagan's workspace, shared with view access for the demo.
- Three or four pre-populated date tabs covering "today" and the last few days, so the daily-drop pattern is visible immediately.
- Exact column layout from the gym example — match the screenshots.
- Color coding: Hot rows tinted, Long-term distinct, do-not-contact red.
- Freeze panes, wrapped text on Key Signals, sensible column widths.
- A "Run today's cycle" button on the dashboard that triggers a fresh write to today's tab in real time. This is what sells the demo: Joseph clicks, watches new rows appear, gets it.
- Direct Google Sheets API integration using a service account.

What you should defer to production:
- n8n integration (direct API works fine for prototype).
- Customer workspace ownership (use Sagan's for prototype).
- Email notifications on completion.
- Conditional formatting for "completed outreach."
- The Summary tab with rolling totals.
- Manual edit preservation logic (in prototype, today's tab is overwritten on re-run, which is fine).
- Sheet recovery if deleted (out of scope until a real customer Sheet exists).

---

# User Story 5 — API endpoint exposing the same data for downstream tools

## What we're building (plain English)

A simple REST endpoint Victor can call from Instantly (or any other tool) to pull today's leads as JSON. Same data as the Sheet, different transport. He authenticates with a bearer token and gets back a paginated list of leads with the same columns the Sheet has.

## The user flow

1. Victor configures Instantly (or n8n, or a custom script) with the API URL and his bearer token.
2. He calls `GET /api/leads?tier=hot&date=2026-05-06`.
3. The API verifies the bearer token, applies the filters, returns JSON.
4. The JSON contains an array of lead objects plus pagination info.
5. Victor pipes the leads into his next tool.

## Deep-dive: every edge case and error

### Authentication

- Single bearer token per consumer. Victor gets one token to start. Future consumers get their own.
- Token format: opaque random 32-byte hex string. Don't use JWTs for prototype — overkill.
- Tokens stored hashed in the database (bcrypt or argon2). Never log raw tokens.
- Token rotation: build a way to rotate (revoke old, issue new) without downtime. For prototype this can be a manual SQL update.
- Rate limit per token: e.g., 60 requests per minute. Prevents accidental denial-of-service from a misconfigured downstream tool.
- All requests over HTTPS. Reject HTTP.

### The endpoint shape

- `GET /api/leads` — returns recent surfaced leads.
- Query parameters:
  - `tier` — filter by hot, warm, long_term. Optional, defaults to all.
  - `date` — single date or date range. Optional, defaults to today.
  - `state` — filter by US state code. Optional.
  - `limit` — page size, defaults to 100, max 500.
  - `cursor` — opaque pagination cursor.
- Response: JSON object with `leads` array, `pagination` object, `metadata` (total count, query echoed back).
- Each lead in the array has the same fields as the Sheet columns: agency name, domain, reason, key_signals (as an array of strings), tier, contact info, etc.
- Use ISO 8601 for all dates. UTC. No timezone-naive dates.

### Pagination

- Cursor-based pagination, not offset. Cursors are stable as new data arrives.
- Cursor is opaque — base64-encoded JSON containing `last_surfaced_at` and `last_id`.
- `next_cursor` returned in pagination object. `null` when no more pages.
- `limit` capped at 500 to prevent runaway responses.

### Errors

- 400 for malformed query parameters. Return a clear error message: `{"error": "tier must be one of: hot, warm, long_term"}`.
- 401 for missing or invalid bearer token.
- 403 for valid token but unauthorized endpoint (future-proofing — for now, all endpoints are open to all valid tokens).
- 404 for unknown endpoints. Don't reveal whether routes exist.
- 429 when rate-limited. Include `Retry-After` header.
- 500 for internal errors. Log internally with full context. Return only `{"error": "Internal server error", "request_id": "abc123"}`.

### Schema versioning

- Include a `schema_version` field in the response. Bump it when you change response shape.
- Document breaking changes prominently.
- Support the previous version for at least 90 days when bumping.
- For prototype, version 1 is fine — no need to plan migrations yet.

### Documentation

- Single one-page README with curl example, JSON shape, common parameters. The PRD is explicit: "Don't over-design. Victor said 'I would keep it simple' at [25:53]."
- Include a Postman/Insomnia collection or a Bruno file if you want to be friendly.
- Show the exact response shape with a real example, not just abstract field descriptions.

### Edge cases

- Lead exists in the database but has missing fields (no domain, no email): return null for those fields, never omit them. Consumers expect a stable schema.
- Date in the future: return empty array, not an error.
- Date too far in the past (before the system started): return empty array, not an error.
- Invalid state code: return 400 with the list of valid codes.
- Empty result set: return `{"leads": [], "pagination": {"next_cursor": null, "total": 0}}`. Don't return 404.
- Concurrent requests with different filters: each request is independent, no interference.

### Security

- All inputs sanitized before going into queries (use parameterized queries, never string concatenation).
- Never include the bearer token in logs or error messages.
- CORS: allow only specific origins. For prototype, allow all (Victor will call from various tools); for production, restrict.
- Don't expose internal IDs (database row IDs). Return UUIDs or stable external IDs.
- Don't include fields the customer doesn't need (cost data, internal scoring weights, raw signal evidence URLs unless explicitly requested).

### Performance

- Index the underlying queries: `daily_drop` table indexed on `date`, `tier`, `state`.
- Cache responses for short windows if the same query is called repeatedly. 60-second TTL is enough.
- Response compression (gzip) — easy win.

### Observability

- Log every API request: timestamp, path, query params (with sensitive fields redacted), token ID (not the raw token), response status, duration.
- Per-token usage metrics: requests per day, errors per day.
- Alert on unusual patterns: a token making 1000x its normal volume, or suddenly getting 500s.

## Testing in plain English

- **Happy path**: hit `GET /api/leads` with a valid token. Verify 200 with a non-empty array.
- **Auth tests**: hit the endpoint with no token (expect 401), with a wrong token (expect 401), with a revoked token (expect 401), with a valid token (expect 200).
- **Filter tests**: try every combination of `tier`, `date`, `state`. Verify the right subset comes back. Try invalid values — expect 400 with clear messages.
- **Pagination test**: with a known dataset, verify `limit=10` returns 10 items, the `next_cursor` works, and following cursors eventually returns empty.
- **Empty result test**: query a future date or a state with no leads. Expect 200 with an empty array, not a 404.
- **Schema stability test**: call the endpoint, save the response. Add new fields to the database. Call again. Verify the response still has the original fields and the schema_version is unchanged unless bumped.
- **Rate limit test**: hammer the endpoint past the rate limit. Verify 429 with `Retry-After` header.
- **CSV injection prevention**: ensure that even when JSON values contain `=` or `+` prefixes, the raw JSON is fine — this matters when Victor pipes JSON into a tool that re-exports to Sheets.
- **Concurrent access**: hit the endpoint from 5 simulated clients at once. Verify all get correct responses, no leakage between requests.
- **Documentation match**: take the curl example from the README, run it against the running API, verify it works exactly as documented.

## 🟢 PROTOTYPE STOP LINE — User Story 5

For the 5-hour prototype, build the minimum: one endpoint, bearer auth, JSON response. Victor needs to see the shape and confirm it works for his workflow. The fancy stuff can wait.

What you should build for the prototype:
- `GET /api/leads` with `tier` and `date` query params.
- Bearer token auth with one hardcoded token for demo (real token rotation can come later).
- JSON response with the same fields as the Sheet columns.
- A one-page README with a working curl example.

What you should defer to production:
- Cursor pagination — for prototype, no pagination is fine since daily drops are small.
- Rate limiting — not needed at demo volume.
- State filter — start with just tier + date, add state later if Victor asks.
- Schema versioning — start at v1 implicitly.
- Per-token usage metrics — not needed yet.
- CORS configuration — accept all origins for prototype.

---

# Cross-cutting concerns (apply to every user story)

These are easy to forget because they don't belong to one user story. They apply to all of them.

## Logging and observability

For the prototype, structured JSON logs are enough. Ship them to Railway's log viewer. Every important operation logs: what happened, with what inputs, what was the result, how long did it take.

For production, add metrics (counts, durations, error rates) and alerts on cycle failures, classifier failures, Sheet write failures, API errors, and cost cap breaches.

## Configuration management

The PRD calls out several places where config needs to be runtime-mutable, not hardcoded: ICP rules, tier weights, signal lifespans, dedup window, cost caps, state priority lists.

Build a single `settings` table in Postgres. Read it on every classifier run. Don't restart the app to change a threshold.

For the prototype, you can hardcode initial defaults but still load through the settings table — it's the same code path, and it makes the demo more credible when Joseph asks "can you tune this?"

## Secrets management

For prototype, environment variables on Railway are fine. Use the variables listed in the PRD: `OPENROUTER_API_KEY`, `ZENROWS_API_KEY`, `SERPER_API_KEY`, `GOOGLE_SHEETS_CREDENTIALS_JSON`, `GOOGLE_SHEETS_SHEET_ID`, `HUBSPOT_API_KEY`, `DATABASE_URL`, `N8N_WEBHOOK_SECRET`, `API_BEARER_TOKEN`.

For production, rotate the keys regularly. Never commit them. Never log them.

## Backups

For prototype, daily snapshot of the SQLite database is fine. Keep 7 days.

For production, Postgres on Railway has continuous backups. Test the restore process at least once before launching — backups you haven't tested aren't backups.

## Documentation

For prototype, a single README explaining how to run the system, how to seed it, how the demo works. Internal-facing.

For production: customer-facing docs (the API one-pager, the Sheet column reference), engineering docs (how the cycle works, how to add a new signal), operational docs (how to read the dashboard, how to respond to alerts).

## Migration path from prototype to production

Build the prototype with the production data model in mind. Specifically:
- The schema for `agencies`, `signal_events`, `tier_history`, `daily_drop`, `surface_history`, and `settings` should be production-correct from day one. Use SQLite for prototype, Postgres for production — swap is a connection string change if you avoid SQLite-specific features.
- Keep the signal generators behind an interface. Production swaps "fake signal generator" for "real ZenRows + Serper scraper" without touching the classifier or Sheet writer.
- The Sheet writer should not care whether signals are real or fake. Same code path.

This is the difference between "prototype as throwaway" and "prototype as foundation." This document is written assuming the foundation approach.

---

# Summary table — what you build vs what you defer

A quick reference. For each user story, here's what makes it into the 5-hour prototype and what waits for production.

| User Story | In the 5-hour prototype | Deferred to production |
|---|---|---|
| 1. TAM upload + ICP | Synthetic seed of ~100 agencies in code; full schema; ICP filter at query time | Real CSV upload UI, file validation, encoding handling, dedup, audit log, rollback |
| 2. Signal monitoring | Fake signal generator with PRD's mix percentages; pre-seeded historical events; static "Hendon recent deals" | All real scraping; rate limiting; cost tracking; HubSpot integration |
| 3. Classifier + dedup | Full rule engine with configurable weights; 60-day cooldown; internal-signal override; AI-generated reasons (cached) | Manual operator overrides; per-rule analytics; demotion logging; signal aging |
| 4. Google Sheet drop | Real Sheet on Sagan's workspace; gym-leads-exact format; color coding; "Run cycle" button writing live | n8n integration; customer workspace ownership; email notifications; recovery handling |
| 5. API endpoint | One GET endpoint; bearer auth; JSON response | Pagination; rate limiting; multi-token management; schema versioning; CORS |

---

# Final note

The 5-hour prototype is not the production system. It's an artifact Joseph and Victor can react to. Its job is to communicate the value clearly and get approval before any real credentials change hands. The depth in this document — every edge case, every error, every test — is for the production build, which is a 60–100 hour engineering effort minimum.

Build the prototype with the production data model. Skip the production complexity. Make the demo feel real.
