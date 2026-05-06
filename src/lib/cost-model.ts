// Cost model — public-pricing rough estimates as of 2026 (configurable in
// settings later, hard-coded for the prototype). Used by /admin/quota and
// the dashboard to surface "$X / day at Y leads/day" inline ranges.
//
// Per the plan §"Cost model" — the prototype reads from fixtures rather than
// making real Serper / OpenRouter / ZenRows calls, but the cost calculator
// displays the *would-be* cost so Joseph sees the production economics.

export const PROVIDER_COSTS = {
  serper: 0.0004,             // per Google Maps lookup
  openrouterLight: 0.0003,    // per Lightweight classification (~500 in / 100 out tokens)
  openrouterMid: 0.003,       // per richer interpretation (rarely used)
  zenrows: 0.005,             // per scraped page (premium_proxy + js_render)
} as const;

// Composite per-row costs.
export const COST_PER_ICP_ROW =
  PROVIDER_COSTS.serper + PROVIDER_COSTS.openrouterLight; // ≈ $0.0007

export const COST_PER_SERVICE_ROW = PROVIDER_COSTS.openrouterLight; // ≈ $0.0003

export const COST_PER_SIGNAL_CYCLE_ROW =
  3 * PROVIDER_COSTS.zenrows + PROVIDER_COSTS.serper + 2 * PROVIDER_COSTS.openrouterLight;
// ≈ $0.0166 per row per cycle (User Story 2)

export interface QuotaCostBreakdown {
  perRow: number;
  perDay: number;
  daysToFinish: number | null; // null when pending == 0 or n == 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const computeIcpCost = (
  leadsPerDay: number,
  pending: number,
): QuotaCostBreakdown => {
  const perDay = round2(leadsPerDay * COST_PER_ICP_ROW);
  const daysToFinish =
    leadsPerDay > 0 && pending > 0 ? Math.ceil(pending / leadsPerDay) : null;
  return { perRow: COST_PER_ICP_ROW, perDay, daysToFinish };
};

export const computeServiceCost = (
  leadsPerDay: number,
  pending: number,
): QuotaCostBreakdown => {
  const perDay = round2(leadsPerDay * COST_PER_SERVICE_ROW);
  const daysToFinish =
    leadsPerDay > 0 && pending > 0 ? Math.ceil(pending / leadsPerDay) : null;
  return { perRow: COST_PER_SERVICE_ROW, perDay, daysToFinish };
};

// Format a per-day USD cost with sane precision.
// 0.07/day reads better than 0.0700/day.
export const formatUsd = (n: number): string => {
  if (n < 0.01) return `< $0.01`;
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
};
