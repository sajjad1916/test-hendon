import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from '../db';
import { render, view, fillTemplate } from '../lib/render';
import {
  runUploadPipeline,
  type ConflictMode,
  type DraftSummary,
} from '../lib/upload-pipeline';
import { commitUpload, discardUpload, type CommitSummary } from '../lib/upload-commit';

const router = new Hono();

const MAX_BYTES = 100 * 1024 * 1024;

interface UploadRow {
  id: number;
  file_hash: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string | null;
  status: string;
  conflict_mode: string | null;
  row_count_in: number | null;
  row_count_inserted: number | null;
  row_count_updated: number | null;
  row_count_errors: number | null;
  icp_pass_count: number | null;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

const formatTimestamp = (sqlIso: string): string => {
  const iso = sqlIso.includes('T') ? sqlIso : `${sqlIso.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return sqlIso;
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const CONFLICT_MODE_LABELS: Record<ConflictMode, string> = {
  add_only: 'Add new only',
  update_add: 'Update existing and add new',
  replace: 'Replace everything',
};

const EXISTING_ACTION_BY_MODE: Record<ConflictMode, string> = {
  add_only: 'will be skipped',
  update_add: 'contact fields will be refreshed',
  replace: 'contact fields will be refreshed',
};

const MISSING_ACTION_BY_MODE: Record<ConflictMode, string> = {
  add_only: 'untouched',
  update_add: 'untouched',
  replace: 'will be marked inactive on commit',
};

// ──────────────── Last-upload tile (unchanged structure, slice-4 origin) ──────

const renderLastUploadTile = (): string => {
  const row = db
    .prepare(
      "SELECT * FROM uploads WHERE status = 'complete' ORDER BY uploaded_at DESC, id DESC LIMIT 1",
    )
    .get() as UploadRow | undefined;
  if (!row) {
    return `
      <p class="mt-3 text-sm text-slate-500">
        No uploads yet. Drop a CSV below to start.
      </p>
    `;
  }
  return `
    <div class="mt-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
      <div class="text-base font-medium text-ink">${escapeHtml(row.filename)}</div>
      <div class="text-xs text-slate-500">
        ${escapeHtml(formatTimestamp(row.uploaded_at))} · by ${escapeHtml(row.uploaded_by ?? 'unknown')}
      </div>
    </div>
    <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">Rows in</dt>
        <dd class="mt-1 text-sm font-medium text-ink">${row.row_count_in ?? '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">Inserted</dt>
        <dd class="mt-1 text-sm font-medium text-ink">${row.row_count_inserted ?? '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">ICP pass</dt>
        <dd class="mt-1 text-sm font-medium text-ink">${row.icp_pass_count ?? '—'}</dd>
      </div>
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">Errors</dt>
        <dd class="mt-1 text-sm font-medium text-ink">${row.row_count_errors ?? 0}</dd>
      </div>
    </dl>
    <p class="mt-4 text-xs text-slate-500">
      File size ${formatSize(row.size_bytes)} · status ${escapeHtml(row.status)} · conflict mode ${escapeHtml(row.conflict_mode ?? '—')}
    </p>
  `;
};

// ──────────────── Recent uploads table (slice 12) ────────────────────────────

interface RecentUploadRow {
  id: number;
  filename: string;
  uploaded_at: string;
  uploaded_by: string | null;
  status: string;
  conflict_mode: string | null;
  row_count_in: number | null;
  row_count_inserted: number | null;
  row_count_errors: number | null;
}

const renderRecentUploadsTable = (): string => {
  const rows = db
    .prepare(
      `SELECT id, filename, uploaded_at, uploaded_by, status, conflict_mode,
              row_count_in, row_count_inserted, row_count_errors
       FROM uploads
       WHERE status = 'complete'
       ORDER BY uploaded_at DESC, id DESC
       LIMIT 10`,
    )
    .all() as RecentUploadRow[];

  if (rows.length === 0) {
    return `<p class="text-sm text-slate-500">No completed uploads yet. Drop a CSV above to start.</p>`;
  }

  const body = rows
    .map(
      (r) => `
        <tr class="border-t border-slate-100">
          <td class="py-2 pr-4 text-sm font-medium text-ink">${escapeHtml(r.filename)}</td>
          <td class="py-2 pr-4 text-xs text-slate-500">${escapeHtml(formatTimestamp(r.uploaded_at))}</td>
          <td class="py-2 pr-4 text-xs text-slate-500">${escapeHtml(r.uploaded_by ?? 'unknown')}</td>
          <td class="py-2 pr-4 text-xs"><span class="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">${escapeHtml(r.status)}</span></td>
          <td class="py-2 pr-4 text-right text-sm tabular-nums text-slate-700">${r.row_count_in ?? '—'}</td>
          <td class="py-2 pr-4 text-right text-sm tabular-nums text-slate-700">${r.row_count_inserted ?? '—'}</td>
          <td class="py-2 pr-0 text-right text-sm tabular-nums ${(r.row_count_errors ?? 0) > 0 ? 'text-amber-700' : 'text-slate-400'}">${r.row_count_errors ?? 0}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <div class="overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr>
            <th class="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Filename</th>
            <th class="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">When</th>
            <th class="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">By</th>
            <th class="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Status</th>
            <th class="pb-2 pr-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">In</th>
            <th class="pb-2 pr-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Inserted</th>
            <th class="pb-2 pr-0 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Errors</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
};

// ──────────────── Fragment helpers (slice 10) ────────────────────────────────

const renderInlineError = (
  heading: string,
  message: string,
  details?: string,
): string => `
  <div class="space-y-4">
    <div class="rounded-2xl border border-rose-200 bg-rose-50 p-5">
      <h2 class="text-base font-semibold text-rose-900">${escapeHtml(heading)}</h2>
      <p class="mt-2 text-sm text-rose-800">${escapeHtml(message)}</p>
      ${details ? `<p class="mt-2 text-xs text-rose-700">${escapeHtml(details)}</p>` : ''}
    </div>
    <a
      href="/admin/upload"
      class="inline-block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900"
    >← back to upload</a>
  </div>
`;

const renderDuplicateFragment = (
  prevFilename: string,
  prevTimestamp: string,
): string => `
  <div class="space-y-4">
    <div class="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <h2 class="text-base font-semibold text-amber-900">Duplicate file detected</h2>
      <p class="mt-2 text-sm text-amber-800">
        This file's SHA-256 matches an upload from <strong>${escapeHtml(formatTimestamp(prevTimestamp))}</strong>
        (<code class="rounded bg-amber-100 px-1 text-xs">${escapeHtml(prevFilename)}</code>).
      </p>
      <p class="mt-2 text-xs text-amber-700">
        No action was taken. If you really meant to re-process the same file, contact the Sagan team.
      </p>
    </div>
    <a
      href="/admin/upload"
      class="inline-block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900"
    >← back to upload</a>
  </div>
`;

const renderStepReview = (draft: DraftSummary): string => {
  const errorsBlock =
    draft.rowCounts.rowsWithErrors > 0
      ? `
    <section class="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Errors</h3>
      <p class="mt-2 text-sm text-amber-900">
        <strong>${draft.rowCounts.rowsWithErrors}</strong> of ${draft.rowCounts.total} rows are missing required columns and will be skipped at commit.
      </p>
      <p class="mt-1 text-xs text-amber-700">
        Required fields are <code class="rounded bg-amber-100 px-1 text-xs">company_name</code> and <code class="rounded bg-amber-100 px-1 text-xs">company_url</code>. Everything else is optional.
      </p>
    </section>
  `
      : '';

  const missingPairs = (
    Object.entries(draft.missingOptionalCounts) as [string, number][]
  ).filter(([, n]) => n > 0);
  const missingOptionalBlock =
    missingPairs.length > 0
      ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Missing optional fields</h3>
      <p class="mt-1 text-xs text-slate-500">
        Won't block the commit. The agent will try to enrich these during the ICP filter and signal monitoring loops.
      </p>
      <ul class="mt-3 grid grid-cols-1 gap-1 text-sm text-slate-700 sm:grid-cols-2">
        ${missingPairs
          .map(
            ([f, n]) =>
              `<li><span class="font-medium">${n}</span> rows missing <code class="rounded bg-slate-100 px-1 text-xs">${escapeHtml(f)}</code></li>`,
          )
          .join('')}
      </ul>
    </section>
  `
      : '';

  const uniqueRecognized = Array.from(new Set(draft.recognizedColumns)).sort();
  const recognizedColsList = uniqueRecognized
    .map((c) => `<li>· <code class="rounded bg-slate-100 px-1 text-xs">${escapeHtml(c)}</code></li>`)
    .join('');

  const unmappedColsList =
    draft.unmappedColumns.length > 0
      ? `<ul class="mt-3 space-y-1 text-sm text-slate-700">${draft.unmappedColumns
          .map(
            (c) =>
              `<li>· ${escapeHtml(c)} <span class="text-xs text-slate-400">(stored in metadata)</span></li>`,
          )
          .join('')}</ul>`
      : `<p class="mt-3 text-sm text-slate-500">None — every column was recognized.</p>`;

  return fillTemplate(view('_step-review.html'), {
    FILENAME: escapeHtml(draft.filename),
    SIZE_HUMAN: formatSize(draft.sizeBytes),
    TOTAL_ROWS: String(draft.rowCounts.total),
    CONFLICT_MODE_LABEL: CONFLICT_MODE_LABELS[draft.conflictMode],
    NEW_COUNT: String(draft.rowCounts.newBucket),
    NEW_ACTION: 'will be inserted on commit',
    EXISTING_COUNT: String(draft.rowCounts.existingBucket),
    EXISTING_ACTION: EXISTING_ACTION_BY_MODE[draft.conflictMode],
    MISSING_COUNT: String(draft.rowCounts.missingBucket),
    MISSING_ACTION: MISSING_ACTION_BY_MODE[draft.conflictMode],
    ICP_PRIMARY: String(draft.icpCounts.primary_icp),
    ICP_SECONDARY: String(draft.icpCounts.secondary_icp),
    ICP_PENDING: String(draft.icpCounts.pending_review),
    ICP_EXCLUDED: String(draft.icpCounts.excluded),
    INFERENCE_EXPLICIT: String(draft.agencyTypeSourceCounts.explicit),
    INFERENCE_INFERRED: String(draft.agencyTypeSourceCounts.inferred_from_name),
    INFERENCE_UNKNOWN: String(draft.agencyTypeSourceCounts.unknown),
    ERRORS_BLOCK: errorsBlock,
    MISSING_OPTIONAL_BLOCK: missingOptionalBlock,
    RECOGNIZED_COUNT: String(uniqueRecognized.length),
    RECOGNIZED_COLS_LIST: recognizedColsList,
    UNMAPPED_COUNT: String(draft.unmappedColumns.length),
    UNMAPPED_COLS_LIST: unmappedColsList,
    UPLOAD_ID: String(draft.uploadId),
    COMMITTABLE_COUNT: String(draft.rowCounts.committable),
  });
};

const renderStepResult = (summary: CommitSummary): string => {
  const softDeleteLine =
    summary.softDeleted > 0
      ? `<p class="mt-3 text-xs text-emerald-700">${summary.softDeleted} agencies missing from this upload were marked inactive (soft-deleted).</p>`
      : '';
  return fillTemplate(view('_step-result.html'), {
    FILENAME: escapeHtml(summary.filename),
    INSERTED: String(summary.inserted),
    UPDATED: String(summary.updated),
    SKIPPED: String(summary.skipped),
    ERRORED: String(summary.errored),
    SOFT_DELETE_LINE: softDeleteLine,
    ENRICHED: String(summary.enriched),
    HOT: String(summary.hot),
    WARM: String(summary.warm),
    LONG_TERM: String(summary.longTerm),
    LAST_UPLOAD_TILE: renderLastUploadTile(),
    RECENT_UPLOADS_TABLE: renderRecentUploadsTable(),
  });
};

// ──────────────── Routes ─────────────────────────────────────────────────────

router.get('/', (c) =>
  c.html(
    render(
      'Upload TAM · Hendon Signal Agent',
      fillTemplate(view('admin-upload.html'), {
        LAST_UPLOAD: renderLastUploadTile(),
        RECENT_UPLOADS: renderRecentUploadsTable(),
      }),
    ),
  ),
);

router.post(
  '/validate',
  bodyLimit({
    maxSize: MAX_BYTES,
    onError: (c) =>
      c.html(
        renderInlineError(
          'File too large',
          `Maximum upload size is ${MAX_BYTES / 1024 / 1024} MB. Trim the file and try again.`,
        ),
        413,
      ),
  }),
  async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    const conflictRaw = body['conflict_mode'];
    const conflictMode: ConflictMode =
      conflictRaw === 'update_add' || conflictRaw === 'replace'
        ? conflictRaw
        : 'add_only';

    if (!file || typeof file === 'string') {
      return c.html(
        renderInlineError(
          'No file received',
          'Pick a CSV with the file picker or drop one onto the upload zone, then submit again.',
        ),
        400,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = runUploadPipeline({
      buffer,
      filename: file.name,
      conflictMode,
    });

    if (!result.ok) {
      if (result.reason === 'duplicate') {
        return c.html(
          renderDuplicateFragment(result.previousFilename, result.previousUploadedAt),
        );
      }
      return c.html(
        renderInlineError('Could not process this file', result.message),
      );
    }

    return c.html(renderStepReview(result.draft));
  },
);

router.post('/commit/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return c.html(
      renderInlineError('Invalid upload id', 'The commit endpoint received an unexpected upload id.'),
      400,
    );
  }
  const summary = commitUpload(id);
  if (!summary) {
    return c.html(
      renderInlineError(
        'Upload not found',
        'No pending upload with that id. It may have been already committed or discarded.',
      ),
      404,
    );
  }
  return c.html(renderStepResult(summary));
});

router.delete('/draft/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return c.body(null, 400);
  }
  discardUpload(id);
  // Tell htmx to do a full page reload to /admin/upload — clears the form
  // back to a fresh state without us having to extract the Step-1 fragment.
  c.header('HX-Redirect', '/admin/upload');
  return c.body(null, 200);
});

export default router;
