// Commit pipeline (slice 11). Reads upload_draft_rows for a pending upload,
// applies the chosen conflict mode (add_only / update_add / replace), writes
// to agencies in a transaction, finalizes the uploads audit row, deletes
// staging rows, then post-commit "enriches" each newly-inserted agency by
// picking a fixture-driven tier + Reason and writing a daily_drop row.
//
// In production, the auto-enrich would be a paced cron loop calling Serper +
// OpenRouter Lightweight against the chosen lead quota. In the prototype,
// it's instant and pulls from openrouter-responses.ts via pickReason().

import { db } from '../db';
import { normalizeDomain, type ConflictMode } from './upload-pipeline';
import { pickReason } from './fixtures/select';
import type { SignalTag, Tier } from './fixtures/_types';

export interface CommitSummary {
  uploadId: number;
  filename: string;
  inserted: number;
  updated: number;
  skipped: number;
  softDeleted: number;
  errored: number;
  icpPassCount: number;
  enriched: number;
  hot: number;
  warm: number;
  longTerm: number;
}

interface DraftRowRecord {
  id: number;
  row_number: number;
  bucket: 'new' | 'existing' | 'missing';
  parsed_data: string;
  validation_errors: string | null;
  target_agency_id: number | null;
  predicted_icp_status: string;
  predicted_agency_type: string;
}

interface UploadRecord {
  id: number;
  filename: string;
  conflict_mode: ConflictMode;
}

const splitOwnerName = (full: string): { first: string; last: string } => {
  const trimmed = full.trim();
  if (trimmed === '') return { first: '', last: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return {
    first: parts.slice(0, -1).join(' '),
    last: parts[parts.length - 1]!,
  };
};

// 20% hot, 35% warm, 45% long_term — deterministic on agency.id so the same
// agency always gets the same tier across runs.
const tierByAgencyId = (agencyId: number): Tier => {
  const h = agencyId % 20;
  if (h < 4) return 'hot';
  if (h < 11) return 'warm';
  return 'long_term';
};

const TAG_POOL: ReadonlyArray<SignalTag> = [
  'owner_age_70_plus',
  'hiring_gm',
  'review_velocity_spike',
  'ad_activity_spike',
  'nearby_closed_deal',
];

const signalsByAgencyId = (
  agencyId: number,
  tier: Tier,
): { type: SignalTag }[] => {
  if (tier === 'hot') {
    return [
      { type: TAG_POOL[agencyId % TAG_POOL.length] as SignalTag },
      { type: TAG_POOL[(agencyId + 1) % TAG_POOL.length] as SignalTag },
    ];
  }
  if (tier === 'warm') {
    return [{ type: TAG_POOL[agencyId % TAG_POOL.length] as SignalTag }];
  }
  return [];
};

const insertAgency = db.prepare(`
  INSERT INTO agencies (
    name, domain, street, city, state, zip, country, phone, email,
    owner_first_name, owner_last_name, owner_age, license_type,
    agency_type, icp_status, is_icp, source
  ) VALUES (
    @name, @domain, @street, @city, @state, @zip, 'US', @phone, @email,
    @owner_first_name, @owner_last_name, @owner_age, @license_type,
    @agency_type, @icp_status, @is_icp, @source
  )
  ON CONFLICT(domain) DO NOTHING
`);

const updateAgencyContact = db.prepare(`
  UPDATE agencies SET
    phone = COALESCE(NULLIF(@phone, ''), phone),
    email = COALESCE(NULLIF(@email, ''), email),
    owner_first_name = COALESCE(NULLIF(@owner_first_name, ''), owner_first_name),
    owner_last_name = COALESCE(NULLIF(@owner_last_name, ''), owner_last_name),
    owner_age = COALESCE(@owner_age, owner_age),
    license_type = CASE WHEN @license_type != 'unknown' THEN @license_type ELSE license_type END,
    agency_type = CASE WHEN @agency_type != 'unknown' THEN @agency_type ELSE agency_type END,
    icp_status = CASE WHEN @icp_status != 'pending_review' THEN @icp_status ELSE icp_status END,
    is_icp = @is_icp,
    last_seen_in_upload_at = datetime('now'),
    updated_at = datetime('now')
  WHERE id = @id
`);

const softDeleteMissing = db.prepare(`
  UPDATE agencies SET tam_status = 'inactive', updated_at = datetime('now')
  WHERE tam_status = 'active'
    AND id NOT IN (
      SELECT target_agency_id FROM upload_draft_rows
      WHERE upload_id = ? AND target_agency_id IS NOT NULL
    )
`);

const insertDailyDrop = db.prepare(`
  INSERT OR IGNORE INTO daily_drop (
    agency_id, drop_date, tier, reason, key_signals, signal_event_ids
  ) VALUES (
    @agency_id, date('now'), @tier, @reason, @key_signals, '[]'
  )
`);

const updateUploadComplete = db.prepare(`
  UPDATE uploads SET
    status = 'complete',
    row_count_inserted = @inserted,
    row_count_updated = @updated,
    row_count_errors = @errored,
    icp_pass_count = @icp_pass_count,
    error_summary = @error_summary
  WHERE id = @id
`);

const deleteDraftRows = db.prepare(
  'DELETE FROM upload_draft_rows WHERE upload_id = ?',
);

const findUpload = db.prepare(
  "SELECT id, filename, conflict_mode FROM uploads WHERE id = ? AND status = 'pending'",
);

const findDrafts = db.prepare(
  'SELECT * FROM upload_draft_rows WHERE upload_id = ? ORDER BY row_number',
);

export const commitUpload = (uploadId: number): CommitSummary | null => {
  const upload = findUpload.get(uploadId) as UploadRecord | undefined;
  if (!upload) return null;

  const drafts = findDrafts.all(uploadId) as DraftRowRecord[];

  const newAgencyIds: number[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let softDeleted = 0;
  let errored = 0;
  let icpPassCount = 0;

  const commitTxn = db.transaction(() => {
    for (const draft of drafts) {
      if (draft.validation_errors) {
        errored++;
        continue;
      }
      const data = JSON.parse(draft.parsed_data) as Record<string, string>;
      const ownerName = data['owner_name'] ?? '';
      const split = ownerName ? splitOwnerName(ownerName) : { first: '', last: '' };
      const ownerFirst = data['owner_first_name'] || split.first;
      const ownerLast = data['owner_last_name'] || split.last;
      const ownerAgeRaw = data['owner_age'];
      const ownerAge =
        ownerAgeRaw && /^\d+$/.test(ownerAgeRaw) ? Number(ownerAgeRaw) : null;
      const licenseType = (data['license_type'] ?? 'unknown').trim().toLowerCase() || 'unknown';
      const isIcp =
        draft.predicted_icp_status === 'primary_icp' ||
        draft.predicted_icp_status === 'secondary_icp'
          ? 1
          : 0;

      if (draft.bucket === 'new') {
        const result = insertAgency.run({
          name: data['company_name'] ?? '',
          domain: normalizeDomain(data['company_url']),
          street: data['street'] ?? null,
          city: data['city'] ?? null,
          state: ((data['state'] ?? '').toUpperCase().slice(0, 2) || null),
          zip: data['zip'] ?? null,
          phone: data['phone'] ?? null,
          email: data['email'] ?? null,
          owner_first_name: ownerFirst || null,
          owner_last_name: ownerLast || null,
          owner_age: ownerAge,
          license_type: licenseType,
          agency_type: draft.predicted_agency_type,
          icp_status: draft.predicted_icp_status,
          is_icp: isIcp,
          source: `upload:${uploadId}`,
        });
        if (result.changes > 0) {
          inserted++;
          if (isIcp) icpPassCount++;
          newAgencyIds.push(Number(result.lastInsertRowid));
        } else {
          // Domain UNIQUE collision — slipped past the validation bucket.
          // Treat as skipped so commit doesn't claim a row that didn't write.
          skipped++;
        }
        continue;
      }

      if (draft.bucket === 'existing') {
        if (upload.conflict_mode === 'add_only') {
          skipped++;
          continue;
        }
        if (draft.target_agency_id !== null) {
          updateAgencyContact.run({
            id: draft.target_agency_id,
            phone: data['phone'] ?? '',
            email: data['email'] ?? '',
            owner_first_name: ownerFirst,
            owner_last_name: ownerLast,
            owner_age: ownerAge,
            license_type: licenseType,
            agency_type: draft.predicted_agency_type,
            icp_status: draft.predicted_icp_status,
            is_icp: isIcp,
          });
          updated++;
          if (isIcp) icpPassCount++;
        }
      }
    }

    if (upload.conflict_mode === 'replace') {
      const r = softDeleteMissing.run(uploadId);
      softDeleted = r.changes;
    }

    updateUploadComplete.run({
      id: uploadId,
      inserted,
      updated,
      errored,
      icp_pass_count: icpPassCount,
      error_summary:
        errored > 0
          ? JSON.stringify({ rows_with_errors: errored })
          : null,
    });

    deleteDraftRows.run(uploadId);
  });

  commitTxn();

  // Auto-enrich newly-inserted agencies: write today's daily_drop with
  // a fixture-driven Reason matching the assigned tier.
  let enriched = 0;
  let hot = 0;
  let warm = 0;
  let longTerm = 0;

  const enrichTxn = db.transaction(() => {
    for (const agencyId of newAgencyIds) {
      const tier = tierByAgencyId(agencyId);
      const signals = signalsByAgencyId(agencyId, tier);
      const reason = pickReason(signals, tier, agencyId);

      const r = insertDailyDrop.run({
        agency_id: agencyId,
        tier,
        reason: reason.reason,
        key_signals: reason.keySignals,
      });
      if (r.changes > 0) {
        enriched++;
        if (tier === 'hot') hot++;
        else if (tier === 'warm') warm++;
        else longTerm++;
      }
    }
  });

  enrichTxn();

  return {
    uploadId,
    filename: upload.filename,
    inserted,
    updated,
    skipped,
    softDeleted,
    errored,
    icpPassCount,
    enriched,
    hot,
    warm,
    longTerm,
  };
};

export const discardUpload = (uploadId: number): boolean => {
  const upload = findUpload.get(uploadId) as { id: number } | undefined;
  if (!upload) return false;
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM upload_draft_rows WHERE upload_id = ?').run(uploadId);
    db.prepare("DELETE FROM uploads WHERE id = ? AND status = 'pending'").run(
      uploadId,
    );
  });
  txn();
  return true;
};
