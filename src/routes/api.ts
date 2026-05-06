// JSON API endpoint (slice 23). Single GET /leads with bearer-token auth.
// Same data as the Sheet drop, different transport — Victor pipes this
// straight into Instantly without manual export.
//
// Schema mirrors the gym-leads column order (PRD line 54 / sheets.ts
// HEADER_ROW), camelCased. Adds `agencyId` so downstream tools can dedup
// across calls.
//
// Out of scope (per slice spec): pagination, rate limiting, state filter,
// CORS, schema versioning. Production swap: rotate the token, add CORS,
// expose schema version in the response envelope.

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { db } from '../db';

const router = new Hono();

const VALID_TIERS = new Set(['hot', 'warm', 'long_term']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const bearerAuth = async (c: Context, next: Next) => {
  const expected = (process.env.API_BEARER_TOKEN ?? '').trim();
  if (!expected) {
    return c.json(
      {
        error: 'server_misconfigured',
        message:
          'API_BEARER_TOKEN is not set on the server. Add it to .env and restart.',
      },
      500,
    );
  }
  const header = c.req.header('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return c.json(
      { error: 'unauthorized', message: 'Missing Bearer token.' },
      401,
    );
  }
  const token = header.slice(7).trim();
  if (token.length === 0 || token !== expected) {
    return c.json(
      { error: 'unauthorized', message: 'Invalid bearer token.' },
      401,
    );
  }
  await next();
};

interface LeadRow {
  agency_id: number;
  drop_date: string;
  tier: 'hot' | 'warm' | 'long_term';
  reason: string;
  key_signals: string;
  name: string;
  domain: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  segment: string | null;
  phone: string | null;
  email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  created_at: string;
}

const fetchLeadsAll = db.prepare(`
  SELECT
    d.agency_id, d.drop_date, d.tier, d.reason, d.key_signals,
    a.name, a.domain, a.street, a.city, a.state, a.zip, a.country,
    a.segment, a.phone, a.email, a.owner_first_name, a.owner_last_name,
    a.created_at
  FROM daily_drop d
  JOIN agencies a ON a.id = d.agency_id
  WHERE d.drop_date = ?
  ORDER BY
    CASE d.tier WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
    a.id
`);

const fetchLeadsByTier = db.prepare(`
  SELECT
    d.agency_id, d.drop_date, d.tier, d.reason, d.key_signals,
    a.name, a.domain, a.street, a.city, a.state, a.zip, a.country,
    a.segment, a.phone, a.email, a.owner_first_name, a.owner_last_name,
    a.created_at
  FROM daily_drop d
  JOIN agencies a ON a.id = d.agency_id
  WHERE d.drop_date = ? AND d.tier = ?
  ORDER BY a.id
`);

const formatAddress = (r: LeadRow): string => {
  const parts = [r.street, r.city, [r.state, r.zip].filter(Boolean).join(' ')]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  return parts.join(', ');
};

const formatOwner = (r: LeadRow): string => {
  const parts = [r.owner_first_name, r.owner_last_name]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  return parts.join(' ');
};

const TIER_LABEL: Record<LeadRow['tier'], string> = {
  hot: 'Hot',
  warm: 'Warm',
  long_term: 'Long-term',
};

const toLeadJson = (r: LeadRow) => ({
  agencyId: r.agency_id,
  created: r.drop_date,
  company: r.name,
  domain: r.domain ?? '',
  reason: r.reason ?? '',
  address: formatAddress(r),
  segment: r.segment ?? '',
  currentStack: '',
  phone: r.phone ?? '',
  socialLinks: '',
  email: r.email ?? '',
  ownerPeople: formatOwner(r),
  keySignals: r.key_signals ?? '',
  country: r.country ?? 'US',
  priorityTier: TIER_LABEL[r.tier],
  notes: '',
  salesperson: '',
});

const todayIso = (): string => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};

router.get('/leads', bearerAuth, (c) => {
  const tierRaw = c.req.query('tier');
  const dateRaw = c.req.query('date');

  const tier = tierRaw && VALID_TIERS.has(tierRaw) ? tierRaw : null;
  const date = dateRaw && ISO_DATE_RE.test(dateRaw) ? dateRaw : todayIso();

  const rows = (
    tier
      ? (fetchLeadsByTier.all(date, tier) as LeadRow[])
      : (fetchLeadsAll.all(date) as LeadRow[])
  );

  return c.json({
    tab: date,
    filters: { tier, date },
    count: rows.length,
    leads: rows.map(toLeadJson),
  });
});

export default router;
