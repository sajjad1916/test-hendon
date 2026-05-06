// Dashboard stats (slice 20). Pure read-side queries that the /admin route
// renders. No writes. Keeps the route handler thin — every query lives here
// with a typed return shape so the view can be a dumb fillTemplate target.

import { db } from '../db';
import { getNumber } from './settings';
import {
  COST_PER_ICP_ROW,
  COST_PER_SERVICE_ROW,
  formatUsd,
} from './cost-model';

export interface AgencyCounts {
  total: number;
  pendingReview: number;
  classified: number;
  excluded: number;
}

export interface QuotaProgress {
  classifiedToday: number;
  icpQuota: number;
  serviceQuota: number;
  spentTodayUsd: number;
  remainingForQuotaUsd: number;
  pctOfDailyQuota: number;
}

export type SignalTypeKey =
  | 'owner_age_70_plus'
  | 'hiring_gm'
  | 'review_velocity_spike'
  | 'ad_activity_spike'
  | 'nearby_closed_deal';

export interface SignalCount {
  signalType: SignalTypeKey;
  count: number;
}

export interface TierCount {
  tier: 'hot' | 'warm' | 'long_term';
  count: number;
}

export interface RecentUpload {
  id: number;
  filename: string;
  uploadedAt: string;
  uploadedBy: string | null;
  rowCountIn: number | null;
  rowCountInserted: number | null;
  rowCountErrors: number | null;
}

const agencyCountsStmt = db.prepare(`
  SELECT
    count(*) AS total,
    sum(CASE WHEN icp_status = 'pending_review' THEN 1 ELSE 0 END) AS pending,
    sum(CASE WHEN icp_status IN ('primary_icp', 'secondary_icp') THEN 1 ELSE 0 END) AS classified,
    sum(CASE WHEN icp_status = 'excluded' THEN 1 ELSE 0 END) AS excluded
  FROM agencies WHERE tam_status = 'active'
`);

export const getAgencyCounts = (): AgencyCounts => {
  const row = agencyCountsStmt.get() as {
    total: number | null;
    pending: number | null;
    classified: number | null;
    excluded: number | null;
  };
  return {
    total: row.total ?? 0,
    pendingReview: row.pending ?? 0,
    classified: row.classified ?? 0,
    excluded: row.excluded ?? 0,
  };
};

const surfacedTodayStmt = db.prepare(
  "SELECT count(DISTINCT agency_id) AS n FROM surface_history WHERE date(surfaced_at) = date('now')",
);

export const getQuotaProgress = (): QuotaProgress => {
  const classifiedToday = (surfacedTodayStmt.get() as { n: number | null }).n ?? 0;
  const icpQuota = getNumber('quota.icp_per_day', 100);
  const serviceQuota = getNumber('quota.service_per_day', 100);
  const spentTodayUsd = classifiedToday * COST_PER_ICP_ROW;
  const remainingForQuotaUsd =
    Math.max(0, icpQuota - classifiedToday) * COST_PER_ICP_ROW;
  const pctOfDailyQuota = icpQuota > 0
    ? Math.min(100, Math.round((classifiedToday / icpQuota) * 100))
    : 0;
  return {
    classifiedToday,
    icpQuota,
    serviceQuota,
    spentTodayUsd,
    remainingForQuotaUsd,
    pctOfDailyQuota,
  };
};

const signalsByTypeStmt = db.prepare(`
  SELECT signal_type, count(*) AS n
  FROM signal_events
  WHERE detected_at >= datetime('now', '-90 days')
  GROUP BY signal_type
`);

const SIGNAL_TYPE_ORDER: SignalTypeKey[] = [
  'owner_age_70_plus',
  'hiring_gm',
  'review_velocity_spike',
  'ad_activity_spike',
  'nearby_closed_deal',
];

export const getSignalsByType = (): SignalCount[] => {
  const rows = signalsByTypeStmt.all() as { signal_type: string; n: number }[];
  const counts = new Map<string, number>(rows.map((r) => [r.signal_type, r.n]));
  return SIGNAL_TYPE_ORDER.map((signalType) => ({
    signalType,
    count: counts.get(signalType) ?? 0,
  }));
};

const tierBreakdownTodayStmt = db.prepare(`
  SELECT tier, count(*) AS n
  FROM daily_drop
  WHERE drop_date = date('now')
  GROUP BY tier
`);

const TIER_ORDER: Array<'hot' | 'warm' | 'long_term'> = ['hot', 'warm', 'long_term'];

export const getTierBreakdown = (): TierCount[] => {
  const rows = tierBreakdownTodayStmt.all() as { tier: string; n: number }[];
  const counts = new Map<string, number>(rows.map((r) => [r.tier, r.n]));
  return TIER_ORDER.map((tier) => ({
    tier,
    count: counts.get(tier) ?? 0,
  }));
};

const recentUploadsStmt = db.prepare(`
  SELECT id, filename, uploaded_at, uploaded_by,
         row_count_in, row_count_inserted, row_count_errors
  FROM uploads
  WHERE status = 'complete'
  ORDER BY uploaded_at DESC, id DESC
  LIMIT 5
`);

export const getRecentUploads = (): RecentUpload[] => {
  const rows = recentUploadsStmt.all() as Array<{
    id: number;
    filename: string;
    uploaded_at: string;
    uploaded_by: string | null;
    row_count_in: number | null;
    row_count_inserted: number | null;
    row_count_errors: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
    rowCountIn: r.row_count_in,
    rowCountInserted: r.row_count_inserted,
    rowCountErrors: r.row_count_errors,
  }));
};

// Day-over-day comparison (today vs yesterday).
// Surfaces day-over-day movement at a glance — Joseph sees "yesterday's hot
// count vs today's" without having to dig into the live Sheet.

export interface TopHotLead {
  company: string;
  state: string | null;
  reasonSnippet: string;
}

export interface DayDrop {
  date: string;
  hot: number;
  warm: number;
  longTerm: number;
  total: number;
  topHot: TopHotLead[];
}

export interface LastTwoDays {
  today: DayDrop;
  yesterday: DayDrop;
}

const tierCountsForDateStmt = db.prepare(`
  SELECT tier, count(*) AS n FROM daily_drop
  WHERE drop_date = ? GROUP BY tier
`);

const topHotForDateStmt = db.prepare(`
  SELECT a.name AS company, a.state, substr(d.reason, 1, 80) AS reason_snippet
  FROM daily_drop d JOIN agencies a ON a.id = d.agency_id
  WHERE d.drop_date = ? AND d.tier = 'hot'
  ORDER BY a.id
  LIMIT 3
`);

const fetchSqlDate = db.prepare("SELECT date(?, ?) AS d");

const getDayDrop = (sqlNowOffset: string, label?: string): DayDrop => {
  const row = fetchSqlDate.get('now', sqlNowOffset) as { d: string };
  const date = label ?? row.d;
  const counts = tierCountsForDateStmt.all(date) as { tier: string; n: number }[];
  const tierCount = (t: string): number =>
    counts.find((c) => c.tier === t)?.n ?? 0;
  const topRows = topHotForDateStmt.all(date) as Array<{
    company: string;
    state: string | null;
    reason_snippet: string;
  }>;
  const hot = tierCount('hot');
  const warm = tierCount('warm');
  const longTerm = tierCount('long_term');
  return {
    date,
    hot,
    warm,
    longTerm,
    total: hot + warm + longTerm,
    topHot: topRows.map((r) => ({
      company: r.company,
      state: r.state,
      reasonSnippet: r.reason_snippet,
    })),
  };
};

export const getLastTwoDaysDrop = (): LastTwoDays => ({
  today: getDayDrop('+0 days'),
  yesterday: getDayDrop('-1 days'),
});

export const formatUsdInline = formatUsd;
