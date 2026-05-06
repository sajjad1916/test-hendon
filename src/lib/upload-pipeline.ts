// Upload pipeline orchestrator (slice 10).
// Inputs:  uploaded file buffer + metadata + chosen conflict mode.
// Outputs: either a draft summary (uploads.status='pending' + N rows in
// upload_draft_rows ready for the Step-2 review screen), or a file-level
// rejection (duplicate hash / parse error / missing required column).
//
// Provenance: agency_type goes through inferAgencyType() so the Review step
// can show "explicit" vs "inferred from name". ICP goes through
// classifyAgencyWithRules() so the Review prediction matches what the
// commit step will actually write.

import { db } from '../db';
import { parseCsv } from './csv-parse';
import {
  mapHeaders,
  REQUIRED_FIELDS,
  type RecognizedField,
} from './header-map';
import { inferAgencyType, type AgencyType, type InferenceSource } from './agency-type';
import {
  classifyAgencyWithRules,
  loadIcpRules,
  type IcpStatus,
  type LicenseType,
} from './icp';
import { sha256Hex } from './file-hash';

export type ConflictMode = 'add_only' | 'update_add' | 'replace';
export type Bucket = 'new' | 'existing' | 'missing';

const VALID_LICENSE_TYPES: ReadonlyArray<LicenseType> = [
  'medicaid',
  'medicare',
  'mixed',
  'private_pay',
  'unknown',
];

// Optional fields tracked for missing-data counts in the Review step.
const OPTIONAL_FIELDS_TRACKED: ReadonlyArray<RecognizedField> = [
  'company_linkedin_url',
  'owner_name',
  'owner_first_name',
  'owner_linkedin_url',
  'email',
  'phone',
  'license_type',
  'agency_type',
];

export interface PipelineInput {
  buffer: Buffer;
  filename: string;
  conflictMode: ConflictMode;
  uploadedBy?: string;
}

export interface DraftSummary {
  uploadId: number;
  filename: string;
  sizeBytes: number;
  fileHash: string;
  conflictMode: ConflictMode;
  rowCounts: {
    total: number;
    newBucket: number;
    existingBucket: number;
    missingBucket: number;
    rowsWithErrors: number;
    committable: number; // total - rowsWithErrors (depends on mode for existing/missing)
  };
  icpCounts: Record<IcpStatus, number>;
  agencyTypeCounts: Record<AgencyType, number>;
  agencyTypeSourceCounts: Record<InferenceSource, number>;
  missingOptionalCounts: Partial<Record<RecognizedField, number>>;
  recognizedColumns: RecognizedField[];
  unmappedColumns: string[];
  headerConflicts: RecognizedField[];
}

export type PipelineResult =
  | { ok: true; draft: DraftSummary }
  | { ok: false; reason: 'duplicate'; previousFilename: string; previousUploadedAt: string }
  | { ok: false; reason: 'file_error'; message: string };

export const normalizeDomain = (raw: string | null | undefined): string => {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
    .split('?')[0]!
    .replace(/\/$/, '');
};

const insertPendingUpload = db.prepare(`
  INSERT INTO uploads (
    file_hash, filename, size_bytes, uploaded_by, status, conflict_mode,
    row_count_in
  ) VALUES (
    @file_hash, @filename, @size_bytes, @uploaded_by, 'pending', @conflict_mode,
    @row_count_in
  )
`);

const insertDraftRow = db.prepare(`
  INSERT INTO upload_draft_rows (
    upload_id, row_number, bucket, parsed_data, validation_errors,
    target_agency_id, predicted_icp_status, predicted_agency_type
  ) VALUES (
    @upload_id, @row_number, @bucket, @parsed_data, @validation_errors,
    @target_agency_id, @predicted_icp_status, @predicted_agency_type
  )
`);

const findAgencyByDomain = db.prepare(
  "SELECT id FROM agencies WHERE domain = ? AND tam_status = 'active' LIMIT 1",
);

const dupHashRow = db.prepare(
  "SELECT filename, uploaded_at FROM uploads WHERE file_hash = ? AND status = 'complete' ORDER BY uploaded_at DESC LIMIT 1",
);

const countActiveAgencies = db.prepare(
  "SELECT count(*) AS n FROM agencies WHERE tam_status = 'active'",
);

const countMatchedAgencies = db.prepare(
  `SELECT count(DISTINCT target_agency_id) AS n FROM upload_draft_rows
   WHERE upload_id = ? AND target_agency_id IS NOT NULL`,
);

interface ProcessedRow {
  bucket: Bucket;
  parsedData: Record<string, string>;
  validationErrors: string[];
  targetAgencyId: number | null;
  predictedAgencyType: AgencyType;
  predictedAgencyTypeSource: InferenceSource;
  predictedIcpStatus: IcpStatus;
}

const processRow = (
  rawRow: string[],
  fields: ReadonlyArray<RecognizedField | null>,
  rawHeaders: ReadonlyArray<string>,
  rules: ReturnType<typeof loadIcpRules>,
): ProcessedRow => {
  const recognized: Partial<Record<RecognizedField, string>> = {};
  const metadata: Record<string, string> = {};

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const value = (rawRow[i] ?? '').trim();
    if (field) {
      // First match wins on duplicate-mapped columns (caller already
      // surfaces the conflict in headerMap.conflicts; we don't auto-merge).
      if (recognized[field] === undefined || recognized[field] === '') {
        recognized[field] = value;
      }
    } else if (value !== '') {
      const rawHeader = rawHeaders[i] ?? `col_${i}`;
      metadata[rawHeader] = value;
    }
  }

  const errors: string[] = [];
  if (!recognized.company_name || recognized.company_name === '') {
    errors.push('missing company_name');
  }
  if (!recognized.company_url || recognized.company_url === '') {
    errors.push('missing company_url');
  }

  // Agency-type inference (explicit > name keyword > unknown).
  const inference = inferAgencyType({
    agencyTypeRaw: recognized.agency_type,
    name: recognized.company_name,
  });

  // License type — accept enum value if present, else 'unknown'.
  const rawLicense = (recognized.license_type ?? '').trim().toLowerCase().replace(/[^a-z_]/g, '_');
  const licenseType: LicenseType = (VALID_LICENSE_TYPES as ReadonlyArray<string>).includes(
    rawLicense,
  )
    ? (rawLicense as LicenseType)
    : 'unknown';

  const state = (recognized.state ?? '').trim().toUpperCase().slice(0, 2);

  const icpStatus = classifyAgencyWithRules(
    {
      agencyType: inference.agencyType,
      licenseType,
      state,
    },
    rules,
  );

  // Domain-based bucket assignment.
  const domain = normalizeDomain(recognized.company_url);
  let bucket: Bucket = 'new';
  let targetAgencyId: number | null = null;
  if (domain) {
    const match = findAgencyByDomain.get(domain) as { id: number } | undefined;
    if (match) {
      bucket = 'existing';
      targetAgencyId = match.id;
    }
  }

  return {
    bucket,
    parsedData: { ...recognized, ...(Object.keys(metadata).length > 0 ? { _metadata: JSON.stringify(metadata) } : {}) } as Record<string, string>,
    validationErrors: errors,
    targetAgencyId,
    predictedAgencyType: inference.agencyType,
    predictedAgencyTypeSource: inference.source,
    predictedIcpStatus: icpStatus,
  };
};

export const runUploadPipeline = (input: PipelineInput): PipelineResult => {
  const fileHash = sha256Hex(input.buffer);
  const sizeBytes = input.buffer.length;

  // Duplicate-hash guard against past *committed* uploads only — pending
  // drafts may share a hash with the same user retrying after a discard.
  const dup = dupHashRow.get(fileHash) as
    | { filename: string; uploaded_at: string }
    | undefined;
  if (dup) {
    return {
      ok: false,
      reason: 'duplicate',
      previousFilename: dup.filename,
      previousUploadedAt: dup.uploaded_at,
    };
  }

  const parsed = parseCsv(input.buffer);
  if (parsed.parseErrors.length > 0) {
    return { ok: false, reason: 'file_error', message: parsed.parseErrors.join('; ') };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, reason: 'file_error', message: 'No data rows in file (only a header).' };
  }

  const headerMap = mapHeaders(parsed.headers);
  if (headerMap.missingRequired.length > 0) {
    return {
      ok: false,
      reason: 'file_error',
      message: `Missing required column(s): ${headerMap.missingRequired.join(', ')}. Required: ${REQUIRED_FIELDS.join(', ')}.`,
    };
  }

  const rules = loadIcpRules();

  const txn = db.transaction(() => {
    const uploadResult = insertPendingUpload.run({
      file_hash: fileHash,
      filename: input.filename,
      size_bytes: sizeBytes,
      uploaded_by: input.uploadedBy ?? 'admin',
      conflict_mode: input.conflictMode,
      row_count_in: parsed.rows.length,
    });
    const uploadId = Number(uploadResult.lastInsertRowid);

    const icpCounts: Record<IcpStatus, number> = {
      primary_icp: 0,
      secondary_icp: 0,
      pending_review: 0,
      excluded: 0,
    };
    const agencyTypeCounts: Record<AgencyType, number> = {
      home_care: 0,
      home_health: 0,
      hospice: 0,
      other: 0,
      unknown: 0,
    };
    const agencyTypeSourceCounts: Record<InferenceSource, number> = {
      explicit: 0,
      inferred_from_name: 0,
      unknown: 0,
    };
    const missingOptionalCounts: Partial<Record<RecognizedField, number>> = {};
    for (const f of OPTIONAL_FIELDS_TRACKED) missingOptionalCounts[f] = 0;
    let newBucket = 0;
    let existingBucket = 0;
    let rowsWithErrors = 0;

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      if (!row) continue;
      const processed = processRow(row, headerMap.fields, parsed.headers, rules);

      insertDraftRow.run({
        upload_id: uploadId,
        row_number: i + 1,
        bucket: processed.bucket,
        parsed_data: JSON.stringify(processed.parsedData),
        validation_errors:
          processed.validationErrors.length > 0
            ? JSON.stringify(processed.validationErrors)
            : null,
        target_agency_id: processed.targetAgencyId,
        predicted_icp_status: processed.predictedIcpStatus,
        predicted_agency_type: processed.predictedAgencyType,
      });

      if (processed.bucket === 'new') newBucket++;
      else if (processed.bucket === 'existing') existingBucket++;

      if (processed.validationErrors.length > 0) rowsWithErrors++;

      icpCounts[processed.predictedIcpStatus]++;
      agencyTypeCounts[processed.predictedAgencyType]++;
      agencyTypeSourceCounts[processed.predictedAgencyTypeSource]++;

      for (const f of OPTIONAL_FIELDS_TRACKED) {
        const v = processed.parsedData[f];
        if (!v || v === '') missingOptionalCounts[f] = (missingOptionalCounts[f] ?? 0) + 1;
      }
    }

    // MISSING bucket = active agencies with domains not matched by any draft row.
    const totalActive = (countActiveAgencies.get() as { n: number }).n;
    const matched = (countMatchedAgencies.get(uploadId) as { n: number }).n;
    const missingBucket = Math.max(0, totalActive - matched);

    const committable = parsed.rows.length - rowsWithErrors;

    const summary: DraftSummary = {
      uploadId,
      filename: input.filename,
      sizeBytes,
      fileHash,
      conflictMode: input.conflictMode,
      rowCounts: {
        total: parsed.rows.length,
        newBucket,
        existingBucket,
        missingBucket,
        rowsWithErrors,
        committable,
      },
      icpCounts,
      agencyTypeCounts,
      agencyTypeSourceCounts,
      missingOptionalCounts,
      recognizedColumns: Object.values(headerMap.recognized) as RecognizedField[],
      unmappedColumns: headerMap.unmapped,
      headerConflicts: headerMap.conflicts,
    };

    return summary;
  });

  return { ok: true, draft: txn() };
};
