-- 002_upload_helpers.sql — slice 7
-- Adds the columns and tables the rest of User Story 1 + User Story 2 need:
--   * agencies.agency_type     — Stage-1 ICP gate (home_care/home_health/hospice/other/unknown)
--   * agencies.icp_status      — 4-state ICP outcome (primary_icp/secondary_icp/excluded/pending_review)
--   * upload_draft_rows        — staging for the Step-2 review screen
--   * hendon_closed_deals      — cross-cutting w/ User Story 2 (nearby-deal signal source)
-- Plus seeded ICP rules, priority states, service-type whitelist, dedup window,
-- and lead-quota defaults under namespaced settings keys.

-- ─── 1. New agency columns ────────────────────────────────────────────────
ALTER TABLE agencies ADD COLUMN agency_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE agencies ADD COLUMN icp_status TEXT NOT NULL DEFAULT 'pending_review';

CREATE INDEX IF NOT EXISTS idx_agencies_agency_type ON agencies (agency_type);
CREATE INDEX IF NOT EXISTS idx_agencies_icp_status ON agencies (icp_status);

-- ─── 2. Backfill agency_type from the seeder's segment column ─────────────
-- Seeder writes segment as "<license_type>_<slug(service_noun)>" (license_type
-- can include 'private_pay' which has its own underscore — so we anchor on the
-- full noun suffix using LIKE/ESCAPE rather than splitting on the first '_').
UPDATE agencies SET agency_type = 'home_care' WHERE
  segment LIKE '%/_homecare' ESCAPE '/'
  OR segment LIKE '%/_carepartners' ESCAPE '/'
  OR segment LIKE '%/_eldercare' ESCAPE '/'
  OR segment LIKE '%/_inhomeservices' ESCAPE '/'
  OR segment LIKE '%/_athomecare' ESCAPE '/';

UPDATE agencies SET agency_type = 'home_health' WHERE
  segment LIKE '%/_homehealth' ESCAPE '/'
  OR segment LIKE '%/_familyhealth' ESCAPE '/'
  OR segment LIKE '%/_nursingsolutions' ESCAPE '/';

UPDATE agencies SET agency_type = 'hospice' WHERE
  segment LIKE '%/_hospice' ESCAPE '/';

UPDATE agencies SET agency_type = 'other' WHERE
  segment LIKE '%/_seniorliving' ESCAPE '/';

-- ─── 3. Backfill icp_status using the two-stage rule from the plan ─────────
-- Stage 1 — service-type gate: 'other' or private-pay → excluded.
UPDATE agencies SET icp_status = 'excluded' WHERE
  agency_type = 'other'
  OR license_type = 'private_pay';

-- Stage 1 — unknown service type → pending_review (already the default, but
-- explicit for readability and to override any earlier set if rerun).
UPDATE agencies SET icp_status = 'pending_review' WHERE
  agency_type = 'unknown' AND icp_status != 'excluded';

-- Stage 2 — Medicaid in any state → primary ICP.
UPDATE agencies SET icp_status = 'primary_icp' WHERE
  license_type = 'medicaid'
  AND agency_type IN ('home_care', 'home_health', 'hospice');

-- Stage 2 — Medicare/mixed in priority states → secondary ICP.
UPDATE agencies SET icp_status = 'secondary_icp' WHERE
  license_type IN ('medicare', 'mixed')
  AND agency_type IN ('home_care', 'home_health', 'hospice')
  AND state IN ('NY', 'NJ', 'FL', 'TX', 'CA');

-- Stage 2 — Medicare/mixed outside priority states → pending_review.
UPDATE agencies SET icp_status = 'pending_review' WHERE
  license_type IN ('medicare', 'mixed')
  AND agency_type IN ('home_care', 'home_health', 'hospice')
  AND state NOT IN ('NY', 'NJ', 'FL', 'TX', 'CA');

-- ─── 4. Upload draft staging ──────────────────────────────────────────────
-- One row per parsed CSV row, attached to a pending uploads row. Cleared on
-- commit or discard. Step 2 (review) reads aggregated counts from this table.
CREATE TABLE IF NOT EXISTS upload_draft_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  bucket TEXT NOT NULL,                    -- 'new' | 'existing' | 'missing'
  parsed_data TEXT NOT NULL,               -- JSON of recognized columns
  validation_errors TEXT,                  -- JSON array of strings, null if clean
  target_agency_id INTEGER REFERENCES agencies (id) ON DELETE SET NULL,
  predicted_icp_status TEXT,
  predicted_agency_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_upload_draft_rows_upload ON upload_draft_rows (upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_draft_rows_bucket ON upload_draft_rows (upload_id, bucket);

-- ─── 5. Hendon closed deals (cross-cutting with User Story 2) ─────────────
-- User Story 1 cross-references this list during upload to exclude already-sold
-- agencies. User Story 2 reads the same rows to drive the nearby-deal signal.
CREATE TABLE IF NOT EXISTS hendon_closed_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hubspot_deal_id TEXT,
  agency_name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  lat REAL,
  lng REAL,
  closed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hendon_closed_deals_state ON hendon_closed_deals (state);
CREATE INDEX IF NOT EXISTS idx_hendon_closed_deals_closed_at ON hendon_closed_deals (closed_at);

-- ─── 6. Seed settings (namespaced keys per the plan) ──────────────────────
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('icp.priority_states',         '["NY","NJ","FL","TX","CA"]'),
  ('icp.service_types',           '["home_care","home_health","hospice"]'),
  ('icp.excluded_service_types',  '["assisted_living","nursing_home","hospital","other"]'),
  ('icp.license_rules',           '{"medicaid":{"any_state":"primary_icp"},"medicare":{"in_priority_states":"secondary_icp","else":"pending_review"},"mixed":{"in_priority_states":"secondary_icp","else":"pending_review"},"private_pay":"excluded","unknown":"pending_review"}'),
  ('quota.icp_per_day',           '100'),
  ('quota.service_per_day',       '100'),
  ('dedup.window_days',           '60'),
  ('dedup.long_term_floor_days',  '180'),
  ('signals.enabled',             '{"owner_age":true,"hiring_gm":true,"review_velocity":true,"ad_activity":true,"nearby_deal":true}');
