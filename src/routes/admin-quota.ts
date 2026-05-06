import { Hono } from 'hono';
import { db } from '../db';
import { render, view, fillTemplate } from '../lib/render';
import {
  computeIcpCost,
  computeServiceCost,
  formatUsd,
  type QuotaCostBreakdown,
} from '../lib/cost-model';
import { invalidateIcpRules } from '../lib/icp';

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

const SETTINGS_KEYS = {
  icp: 'quota.icp_per_day',
  service: 'quota.service_per_day',
} as const;

const DEFAULT_QUOTAS = {
  icp: 100,
  service: 100,
} as const;

const readQuota = (key: string, fallback: number): number => {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const writeQuota = (key: string, n: number): void => {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, String(n));
};

const countPending = (): number => {
  const row = db
    .prepare(
      "SELECT count(*) AS n FROM agencies WHERE icp_status = 'pending_review' AND tam_status = 'active'",
    )
    .get() as { n: number };
  return row.n;
};

const renderCostLineInner = (
  type: 'icp' | 'service',
  n: number,
  pending: number,
): { breakdown: QuotaCostBreakdown; html: string } => {
  const breakdown =
    type === 'icp' ? computeIcpCost(n, pending) : computeServiceCost(n, pending);

  let body: string;
  if (n <= 0) {
    body = `<span class="font-medium text-amber-700">Set a value above 0</span> to start the daily quota.`;
  } else {
    const cost = formatUsd(breakdown.perDay);
    const days =
      breakdown.daysToFinish === null
        ? 'no agencies pending'
        : `~${breakdown.daysToFinish} day${breakdown.daysToFinish === 1 ? '' : 's'} to finish ${pending.toLocaleString()} pending`;
    body = `Estimated cost: <span class="font-medium text-slate-700">${cost}</span> / day at <span class="font-medium text-slate-700">${n.toLocaleString()}</span> leads/day · ${days}.`;
  }

  return {
    breakdown,
    html: body,
  };
};

const COST_LINE_TARGET_BY_TYPE: Record<'icp' | 'service', string> = {
  icp: 'icp-cost-line',
  service: 'service-cost-line',
};

const renderCostLineFragment = (
  type: 'icp' | 'service',
  n: number,
  pending: number,
): string => {
  const { html } = renderCostLineInner(type, n, pending);
  return `<p id="${COST_LINE_TARGET_BY_TYPE[type]}" class="mt-2 ml-7 text-xs text-slate-500">${html}</p>`;
};

router.get('/', (c) => {
  const pending = countPending();
  const icpN = readQuota(SETTINGS_KEYS.icp, DEFAULT_QUOTAS.icp);
  const serviceN = readQuota(SETTINGS_KEYS.service, DEFAULT_QUOTAS.service);

  return c.html(
    render(
      'Lead quota · Hendon Signal Agent',
      fillTemplate(view('admin-quota.html'), {
        PENDING_COUNT: pending.toLocaleString(),
        ICP_PER_DAY: String(icpN),
        SERVICE_PER_DAY: String(serviceN),
        ICP_COST_LINE: renderCostLineInner('icp', icpN, pending).html,
        SERVICE_COST_LINE: renderCostLineInner('service', serviceN, pending).html,
      }),
    ),
  );
});

router.get('/cost-line', (c) => {
  const typeRaw = c.req.query('type');
  const nRaw = c.req.query('n');
  const type: 'icp' | 'service' = typeRaw === 'service' ? 'service' : 'icp';
  // The htmx hx-include sends the input under its `name` (quota_icp_per_day /
  // quota_service_per_day), not `n`. Read either.
  const fromName =
    type === 'icp'
      ? c.req.query('quota_icp_per_day')
      : c.req.query('quota_service_per_day');
  const raw = nRaw ?? fromName ?? '0';
  const n = Math.max(0, Math.floor(Number(raw) || 0));

  const pending = countPending();
  return c.html(renderCostLineFragment(type, n, pending));
});

router.post('/save', async (c) => {
  const body = await c.req.parseBody();
  const icpRaw = body['quota_icp_per_day'];
  const serviceRaw = body['quota_service_per_day'];

  const icpN = Math.max(
    0,
    Math.floor(Number(typeof icpRaw === 'string' ? icpRaw : '') || 0),
  );
  const serviceN = Math.max(
    0,
    Math.floor(Number(typeof serviceRaw === 'string' ? serviceRaw : '') || 0),
  );

  writeQuota(SETTINGS_KEYS.icp, icpN);
  writeQuota(SETTINGS_KEYS.service, serviceN);
  // Future-proof: invalidate any cached settings consumers might be holding.
  invalidateIcpRules();

  return c.html(
    `<span id="save-pill" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Saved · ${escapeHtml(`${icpN.toLocaleString()} ICP / ${serviceN.toLocaleString()} service per day`)}</span>`,
  );
});

export default router;
