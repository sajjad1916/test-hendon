import { Hono } from 'hono';
import { render, view, fillTemplate } from '../lib/render';
import {
  getAgencyCounts,
  getQuotaProgress,
  getSignalsByType,
  getTierBreakdown,
  getRecentUploads,
  getLastTwoDaysDrop,
  formatUsdInline,
  type SignalCount,
  type TierCount,
  type RecentUpload,
  type DayDrop,
} from '../lib/dashboard-stats';
import { runCycle } from '../lib/run-cycle';

const router = new Hono();

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

const SIGNAL_LABEL: Record<string, string> = {
  owner_age_70_plus: 'Owner age 70+',
  hiring_gm: 'Hiring a GM',
  review_velocity_spike: 'Review velocity spike',
  ad_activity_spike: 'Ad activity spike',
  nearby_closed_deal: 'Nearby Hendon deal',
};

const TIER_LABEL: Record<string, string> = {
  hot: 'Hot',
  warm: 'Warm',
  long_term: 'Long-term',
};

const TIER_COLOR: Record<string, string> = {
  hot: 'bg-amber-500',
  warm: 'bg-brand',
  long_term: 'bg-slate-400',
};

const renderSignalsBars = (signals: SignalCount[]): string => {
  const max = Math.max(1, ...signals.map((s) => s.count));
  return signals
    .map((s) => {
      const pct = Math.round((s.count / max) * 100);
      const label = SIGNAL_LABEL[s.signalType] ?? s.signalType;
      return `
        <div>
          <div class="flex items-baseline justify-between text-xs">
            <span class="text-slate-700">${escapeHtml(label)}</span>
            <span class="font-medium tabular-nums text-slate-600">${s.count}</span>
          </div>
          <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-brand" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
};

const renderTierBars = (tiers: TierCount[]): string => {
  const max = Math.max(1, ...tiers.map((t) => t.count));
  return tiers
    .map((t) => {
      const pct = Math.round((t.count / max) * 100);
      const label = TIER_LABEL[t.tier] ?? t.tier;
      const color = TIER_COLOR[t.tier] ?? 'bg-slate-400';
      return `
        <div>
          <div class="flex items-baseline justify-between text-xs">
            <span class="text-slate-700">${escapeHtml(label)}</span>
            <span class="font-medium tabular-nums text-slate-600">${t.count}</span>
          </div>
          <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full ${color}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
};

const renderDayCard = (
  day: DayDrop,
  label: 'Today' | 'Yesterday',
  variant: 'primary' | 'muted',
): string => {
  const cardCls =
    variant === 'primary'
      ? 'rounded-2xl border border-brand/30 bg-brand/5 p-5'
      : 'rounded-2xl border border-slate-200 bg-white p-5';
  const labelColor =
    variant === 'primary' ? 'text-brand-dark' : 'text-slate-500';

  if (day.total === 0) {
    return `
      <div class="${cardCls}">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xs font-semibold uppercase tracking-[0.18em] ${labelColor}">${label}</h3>
          <span class="text-xs text-slate-400">${escapeHtml(day.date)}</span>
        </div>
        <p class="mt-3 text-sm text-slate-500">
          No drop yet for ${escapeHtml(day.date)}.
          ${label === 'Today' ? 'Click <span class="font-medium text-brand-dark">Run cycle now</span> below to surface leads.' : 'Run cycle yesterday or seed history to fill this view.'}
        </p>
      </div>
    `;
  }

  const topList =
    day.topHot.length > 0
      ? day.topHot
          .map(
            (t) => `
        <li class="border-t border-slate-100 pt-2">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium text-ink">${escapeHtml(t.company)}</span>
            <span class="shrink-0 text-xs text-slate-400">${escapeHtml(t.state ?? '')}</span>
          </div>
          <p class="mt-0.5 text-xs text-slate-600">${escapeHtml(t.reasonSnippet)}${t.reasonSnippet.length >= 80 ? '…' : ''}</p>
        </li>
      `,
          )
          .join('')
      : `<li class="text-xs italic text-slate-400">No hot leads on this drop.</li>`;

  return `
    <div class="${cardCls}">
      <div class="flex items-baseline justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-[0.18em] ${labelColor}">${label}</h3>
        <span class="text-xs text-slate-400">${escapeHtml(day.date)}</span>
      </div>
      <p class="mt-3 text-sm text-slate-700">
        <span class="text-2xl font-semibold text-ink">${day.total}</span>
        <span class="ml-2 text-xs text-slate-500">leads</span>
        <span class="ml-3 text-xs">
          <span class="font-medium text-amber-700">${day.hot}</span> hot ·
          <span class="font-medium text-brand-dark">${day.warm}</span> warm ·
          <span class="font-medium text-slate-600">${day.longTerm}</span> long-term
        </span>
      </p>
      <ul class="mt-3 space-y-2">
        ${topList}
      </ul>
    </div>
  `;
};

const renderRecentUploads = (uploads: RecentUpload[]): string => {
  if (uploads.length === 0) {
    return `<p class="text-sm text-slate-500">No completed uploads yet.</p>`;
  }
  const body = uploads
    .map(
      (u) => `
      <tr class="border-t border-slate-100">
        <td class="py-2 pr-4 text-sm font-medium text-ink">${escapeHtml(u.filename)}</td>
        <td class="py-2 pr-4 text-xs text-slate-500">${escapeHtml(formatTimestamp(u.uploadedAt))}</td>
        <td class="py-2 pr-4 text-xs text-slate-500">${escapeHtml(u.uploadedBy ?? 'unknown')}</td>
        <td class="py-2 pr-4 text-right text-sm tabular-nums text-slate-700">${u.rowCountIn ?? '—'}</td>
        <td class="py-2 pr-4 text-right text-sm tabular-nums text-slate-700">${u.rowCountInserted ?? '—'}</td>
        <td class="py-2 pr-0 text-right text-sm tabular-nums ${(u.rowCountErrors ?? 0) > 0 ? 'text-amber-700' : 'text-slate-400'}">${u.rowCountErrors ?? 0}</td>
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

const renderDashboardTiles = (): string => {
  const counts = getAgencyCounts();
  return `
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Total agencies</p>
      <p class="mt-2 text-3xl font-semibold text-ink">${counts.total.toLocaleString()}</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Pending ICP review</p>
      <p class="mt-2 text-3xl font-semibold text-amber-700">${counts.pendingReview.toLocaleString()}</p>
    </div>
    <div class="rounded-2xl border border-brand/30 bg-brand/5 p-5 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wider text-brand-dark">Classified</p>
      <p class="mt-2 text-3xl font-semibold text-ink">${counts.classified.toLocaleString()}</p>
      <p class="mt-1 text-xs text-slate-500">primary + secondary ICP</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Excluded</p>
      <p class="mt-2 text-3xl font-semibold text-slate-700">${counts.excluded.toLocaleString()}</p>
    </div>
  `;
};

router.get('/', (c) => {
  const counts = getAgencyCounts();
  // Render the dashboard regardless of whether the DB has data.
  // Empty-state copy in the 2-day cards + zero-count tiles handle the
  // cold-start case; users navigate to /admin/upload via the brand-strip
  // nav when they're ready.
  const quota = getQuotaProgress();
  const signals = getSignalsByType();
  const tiers = getTierBreakdown();
  const uploads = getRecentUploads();
  const lastTwoDays = getLastTwoDaysDrop();

  const costLine = `${formatUsdInline(quota.spentTodayUsd)} spent today · ~${formatUsdInline(quota.remainingForQuotaUsd)} to finish today's quota (${quota.classifiedToday} / ${quota.icpQuota.toLocaleString()} leads).`;

  return c.html(
    render(
      'Dashboard · Hendon Signal Agent',
      fillTemplate(view('admin.html'), {
        TOTAL_COUNT: counts.total.toLocaleString(),
        PENDING_COUNT: counts.pendingReview.toLocaleString(),
        CLASSIFIED_COUNT: counts.classified.toLocaleString(),
        EXCLUDED_COUNT: counts.excluded.toLocaleString(),
        CLASSIFIED_TODAY: quota.classifiedToday.toLocaleString(),
        ICP_QUOTA: quota.icpQuota.toLocaleString(),
        QUOTA_PCT: String(quota.pctOfDailyQuota),
        COST_LINE: costLine,
        SIGNALS_BAR_CHART: renderSignalsBars(signals),
        TIER_BAR_CHART: renderTierBars(tiers),
        RECENT_UPLOADS: renderRecentUploads(uploads),
        TODAY_CARD: renderDayCard(lastTwoDays.today, 'Today', 'primary'),
        YESTERDAY_CARD: renderDayCard(lastTwoDays.yesterday, 'Yesterday', 'muted'),
      }),
    ),
  );
});

router.post('/run-cycle', async (c) => {
  let result;
  try {
    result = await runCycle();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.html(
      `<div class="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
         <p class="text-sm font-semibold">Cycle failed</p>
         <p class="mt-2 text-xs">${escapeHtml(msg)}</p>
       </div>`,
      500,
    );
  }

  const seconds = (result.durationMs / 1000).toFixed(1);
  const sheetLabel =
    result.sheetMode === 'live'
      ? `wrote ${result.sheetRows} rows to today's tab on the live Sheet`
      : `built ${result.sheetRows} rows (dry-run — set GOOGLE_SHEETS_SHEET_ID + GOOGLE_SHEETS_CREDENTIALS_JSON_PATH to write live)`;

  // Result fragment + OOB swap of the 4 dashboard tiles so counts refresh in place.
  return c.html(`
    <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
      <div class="flex items-start gap-3">
        <svg class="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <div>
          <p class="text-sm font-semibold">Cycle complete in ${seconds}s</p>
          <p class="mt-1 text-xs">
            Processed ${result.agenciesProcessed} agencies · ${result.newSignals} new signal${result.newSignals === 1 ? '' : 's'} ·
            surfaced ${result.surfaced} (hot ${result.hot} · warm ${result.warm} · long-term ${result.longTerm}) ·
            filled ${result.reasonsFilled} Reason${result.reasonsFilled === 1 ? '' : 's'}.
          </p>
          <p class="mt-1 text-xs">${sheetLabel}.</p>
        </div>
      </div>
    </div>
    <div id="dashboard-stats" hx-swap-oob="innerHTML">
      ${renderDashboardTiles()}
    </div>
  `);
});

export default router;
