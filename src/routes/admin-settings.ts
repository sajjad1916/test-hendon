// admin-settings — slice 19. Zapier-style toggle panel for the eight knobs
// Joseph cares about: signals on/off, tier weights + thresholds, dedup window,
// ICP rules, priority states, lead quotas, output channels, AI narrative.
//
// Each section has its own form + its own Save button + its own #save-pill-N
// so multiple sections can show "Saved" simultaneously. POST /save?section=N
// dispatches on the section query and only persists keys for that section.
//
// New keys this slice introduces (not in migration 002, INSERT OR IGNORE'd
// on the GET handler the first time it runs so we never modify a migration):
//   * dedup.long_term_floor_enabled  (default 'true')
//   * output.sheet_enabled           (default 'true')
//   * output.api_enabled             (default 'true')
//   * ai.narrative_enabled           (default 'true')

import { Hono } from 'hono';
import { render, view, fillTemplate } from '../lib/render';
import {
  getJson,
  setJson,
  getNumber,
  setNumber,
  getBoolean,
  setBoolean,
  seedRawIfMissing,
} from '../lib/settings';
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

// ─── Constants & defaults ─────────────────────────────────────────────────

type SignalKey =
  | 'owner_age'
  | 'hiring_gm'
  | 'review_velocity'
  | 'ad_activity'
  | 'nearby_deal';

const SIGNAL_KEYS: ReadonlyArray<{ key: SignalKey; label: string }> = [
  { key: 'owner_age', label: 'Owner age 70+' },
  { key: 'hiring_gm', label: 'Hiring a GM' },
  { key: 'review_velocity', label: 'Review velocity spike' },
  { key: 'ad_activity', label: 'Ad activity spike' },
  { key: 'nearby_deal', label: 'Nearby Hendon deal' },
];

const DEFAULT_SIGNALS_ENABLED: Record<SignalKey, boolean> = {
  owner_age: true,
  hiring_gm: true,
  review_velocity: true,
  ad_activity: true,
  nearby_deal: true,
};

type TierWeightKey =
  | 'owner_age_70_plus'
  | 'hiring_gm'
  | 'review_velocity_spike'
  | 'ad_activity_spike'
  | 'nearby_closed_deal';

const TIER_WEIGHT_FIELDS: ReadonlyArray<{
  key: TierWeightKey;
  label: string;
  fallback: number;
}> = [
  { key: 'owner_age_70_plus', label: 'Owner age 70+', fallback: 3 },
  { key: 'hiring_gm', label: 'Hiring GM', fallback: 2 },
  { key: 'review_velocity_spike', label: 'Review velocity', fallback: 1 },
  { key: 'ad_activity_spike', label: 'Ad activity', fallback: 1 },
  { key: 'nearby_closed_deal', label: 'Nearby deal', fallback: 4 },
];

const DEFAULT_TIER_WEIGHTS: Record<TierWeightKey, number> = {
  owner_age_70_plus: 3,
  hiring_gm: 2,
  review_velocity_spike: 1,
  ad_activity_spike: 1,
  nearby_closed_deal: 4,
};

const DEFAULT_TIER_THRESHOLDS = { hot: 6, warm: 2 };

const LICENSE_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'medicaid', label: 'Medicaid' },
  { key: 'medicare', label: 'Medicare' },
  { key: 'mixed', label: 'Mixed' },
  { key: 'private_pay', label: 'Private pay' },
];

const SERVICE_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'home_care', label: 'Home care' },
  { key: 'home_health', label: 'Home health' },
  { key: 'hospice', label: 'Hospice' },
  { key: 'assisted_living', label: 'Assisted living' },
  { key: 'nursing_home', label: 'Nursing home' },
  { key: 'hospital', label: 'Hospital' },
];

const ALL_STATES: ReadonlyArray<string> = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const DEFAULT_PRIORITY_STATES = ['NY', 'NJ', 'FL', 'TX', 'CA'];

// ─── Settings keys ────────────────────────────────────────────────────────

const KEYS = {
  signalsEnabled: 'signals.enabled',
  tierWeights: 'tier.weights',
  tierThresholds: 'tier.thresholds',
  dedupWindowDays: 'dedup.window_days',
  dedupLongTermFloorEnabled: 'dedup.long_term_floor_enabled',
  dedupLongTermFloorDays: 'dedup.long_term_floor_days',
  icpLicenseRules: 'icp.license_rules',
  icpServiceTypes: 'icp.service_types',
  icpExcludedServiceTypes: 'icp.excluded_service_types',
  icpPriorityStates: 'icp.priority_states',
  quotaIcpPerDay: 'quota.icp_per_day',
  quotaServicePerDay: 'quota.service_per_day',
  outputSheetEnabled: 'output.sheet_enabled',
  outputApiEnabled: 'output.api_enabled',
  aiNarrativeEnabled: 'ai.narrative_enabled',
} as const;

// Seed any keys this slice introduces. INSERT OR IGNORE so re-runs are
// no-ops and existing migration values are never clobbered.
const seedNewKeys = (): void => {
  seedRawIfMissing(KEYS.dedupLongTermFloorEnabled, 'true');
  seedRawIfMissing(KEYS.outputSheetEnabled, 'true');
  seedRawIfMissing(KEYS.outputApiEnabled, 'true');
  seedRawIfMissing(KEYS.aiNarrativeEnabled, 'true');
};

// ─── Render helpers ───────────────────────────────────────────────────────

const renderToggle = (name: string, label: string, checked: boolean): string => `
      <div class="flex items-center gap-3">
        <label class="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" name="${escapeHtml(name)}" value="1" ${checked ? 'checked' : ''} class="peer sr-only">
          <div class="peer h-6 w-11 rounded-full bg-slate-200 peer-checked:bg-brand after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
        </label>
        <span class="text-sm text-ink">${escapeHtml(label)}</span>
      </div>`;

const renderNumberField = (
  name: string,
  label: string,
  value: number,
  min = 0,
  max = 1000,
): string => `
        <div>
          <label for="${escapeHtml(name)}" class="block text-xs font-medium text-slate-600">${escapeHtml(label)}</label>
          <input
            type="number"
            id="${escapeHtml(name)}"
            name="${escapeHtml(name)}"
            value="${escapeHtml(String(value))}"
            min="${min}"
            max="${max}"
            step="1"
            class="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>`;

const renderCheckbox = (name: string, label: string, checked: boolean): string => `
        <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          <input type="checkbox" name="${escapeHtml(name)}" value="1" ${checked ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand">
          <span class="text-ink">${escapeHtml(label)}</span>
        </label>`;

const renderPill = (n: number, hint?: string): string => {
  const hintHtml = hint
    ? ` <span class="ml-2 text-slate-500">${escapeHtml(hint)}</span>`
    : '';
  return `<span id="save-pill-${n}" class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Saved</span>${hintHtml}`;
};

// ─── GET / — render the page ──────────────────────────────────────────────

router.get('/', (c) => {
  seedNewKeys();

  // 01. Signals
  const signalsEnabled = getJson<Record<string, boolean>>(
    KEYS.signalsEnabled,
    DEFAULT_SIGNALS_ENABLED,
  );
  const signalsHtml = SIGNAL_KEYS.map((s) =>
    renderToggle(`signals_${s.key}`, s.label, signalsEnabled[s.key] === true),
  ).join('\n');

  // 02. Tier rules
  const tierWeights = getJson<Record<string, number>>(
    KEYS.tierWeights,
    DEFAULT_TIER_WEIGHTS,
  );
  const tierThresholds = getJson<{ hot: number; warm: number }>(
    KEYS.tierThresholds,
    DEFAULT_TIER_THRESHOLDS,
  );
  const tierWeightsHtml = TIER_WEIGHT_FIELDS.map((f) =>
    renderNumberField(
      `tier_weight_${f.key}`,
      f.label,
      Number(tierWeights[f.key] ?? f.fallback),
      0,
      100,
    ),
  ).join('\n');
  const tierThresholdsHtml = [
    renderNumberField(
      'tier_threshold_hot',
      'Hot threshold',
      Number(tierThresholds.hot ?? DEFAULT_TIER_THRESHOLDS.hot),
      0,
      1000,
    ),
    renderNumberField(
      'tier_threshold_warm',
      'Warm threshold',
      Number(tierThresholds.warm ?? DEFAULT_TIER_THRESHOLDS.warm),
      0,
      1000,
    ),
  ].join('\n');

  // 03. Dedup
  const dedupWindowDays = getNumber(KEYS.dedupWindowDays, 60);
  const dedupFloorEnabled = getBoolean(KEYS.dedupLongTermFloorEnabled, true);
  const dedupFloorDays = getNumber(KEYS.dedupLongTermFloorDays, 180);

  // 04. ICP rules
  const licenseRules = getJson<Record<string, unknown>>(KEYS.icpLicenseRules, {});
  const licenseInScope = (key: string): boolean => {
    const v = licenseRules[key];
    if (v === undefined || v === null) return false;
    if (v === 'excluded') return false;
    return true;
  };
  const licenseHtml = LICENSE_TYPES.map((l) =>
    renderCheckbox(`icp_license_${l.key}`, l.label, licenseInScope(l.key)),
  ).join('\n');

  const icpServiceTypes = new Set(
    getJson<string[]>(KEYS.icpServiceTypes, ['home_care', 'home_health', 'hospice']),
  );
  const serviceHtml = SERVICE_TYPES.map((s) =>
    renderCheckbox(`icp_service_${s.key}`, s.label, icpServiceTypes.has(s.key)),
  ).join('\n');

  // 05. Priority states
  const priorityStates = new Set(
    getJson<string[]>(KEYS.icpPriorityStates, DEFAULT_PRIORITY_STATES),
  );
  const stateHtml = ALL_STATES.map((st) =>
    renderCheckbox(`state_${st}`, st, priorityStates.has(st)),
  ).join('\n');

  // 06. Quotas
  const quotaIcp = getNumber(KEYS.quotaIcpPerDay, 100);
  const quotaService = getNumber(KEYS.quotaServicePerDay, 100);

  // 07. Output channels
  const outputSheetEnabled = getBoolean(KEYS.outputSheetEnabled, true);
  const outputApiEnabled = getBoolean(KEYS.outputApiEnabled, true);

  // 08. AI narrative
  const aiNarrativeEnabled = getBoolean(KEYS.aiNarrativeEnabled, true);

  return c.html(
    render(
      'Settings · Hendon Signal Agent',
      fillTemplate(view('admin-settings.html'), {
        SIGNALS_TOGGLES: signalsHtml,
        TIER_WEIGHT_INPUTS: tierWeightsHtml,
        TIER_THRESHOLD_INPUTS: tierThresholdsHtml,
        DEDUP_WINDOW_DAYS: String(dedupWindowDays),
        DEDUP_LONG_TERM_FLOOR_ENABLED_CHECKED: dedupFloorEnabled ? 'checked' : '',
        DEDUP_LONG_TERM_FLOOR_DAYS: String(dedupFloorDays),
        ICP_LICENSE_CHECKBOXES: licenseHtml,
        ICP_SERVICE_CHECKBOXES: serviceHtml,
        PRIORITY_STATE_CHECKBOXES: stateHtml,
        QUOTA_ICP_PER_DAY: String(quotaIcp),
        QUOTA_SERVICE_PER_DAY: String(quotaService),
        OUTPUT_SHEET_ENABLED_CHECKED: outputSheetEnabled ? 'checked' : '',
        OUTPUT_API_ENABLED_CHECKED: outputApiEnabled ? 'checked' : '',
        AI_NARRATIVE_ENABLED_CHECKED: aiNarrativeEnabled ? 'checked' : '',
      }),
    ),
  );
});

// ─── POST /save — dispatch on ?section=N ──────────────────────────────────

const readBoolFromBody = (
  body: Record<string, unknown>,
  name: string,
): boolean => body[name] !== undefined && body[name] !== '';

const readNumberFromBody = (
  body: Record<string, unknown>,
  name: string,
  fallback: number,
  min = 0,
): number => {
  const raw = body[name];
  const n = Number(typeof raw === 'string' ? raw : '');
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
};

router.post('/save', async (c) => {
  const sectionRaw = c.req.query('section');
  const section = Number(sectionRaw);
  if (!Number.isInteger(section) || section < 1 || section > 8) {
    return c.html(
      `<span id="save-pill-0" class="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">Unknown section</span>`,
      400,
    );
  }

  const body = (await c.req.parseBody()) as Record<string, unknown>;

  switch (section) {
    case 1: {
      const next: Record<SignalKey, boolean> = { ...DEFAULT_SIGNALS_ENABLED };
      for (const s of SIGNAL_KEYS) {
        next[s.key] = readBoolFromBody(body, `signals_${s.key}`);
      }
      setJson(KEYS.signalsEnabled, next);
      return c.html(renderPill(1));
    }
    case 2: {
      const weights: Record<TierWeightKey, number> = { ...DEFAULT_TIER_WEIGHTS };
      for (const f of TIER_WEIGHT_FIELDS) {
        weights[f.key] = readNumberFromBody(body, `tier_weight_${f.key}`, f.fallback);
      }
      const thresholds = {
        hot: readNumberFromBody(body, 'tier_threshold_hot', DEFAULT_TIER_THRESHOLDS.hot),
        warm: readNumberFromBody(body, 'tier_threshold_warm', DEFAULT_TIER_THRESHOLDS.warm),
      };
      setJson(KEYS.tierWeights, weights);
      setJson(KEYS.tierThresholds, thresholds);
      // Cheap, no-harm: future-proof in case anyone caches.
      invalidateIcpRules();
      return c.html(renderPill(2, 'Run npm run classify to apply.'));
    }
    case 3: {
      setNumber(
        KEYS.dedupWindowDays,
        readNumberFromBody(body, 'dedup_window_days', 60),
      );
      setBoolean(
        KEYS.dedupLongTermFloorEnabled,
        readBoolFromBody(body, 'dedup_long_term_floor_enabled'),
      );
      setNumber(
        KEYS.dedupLongTermFloorDays,
        readNumberFromBody(body, 'dedup_long_term_floor_days', 180),
      );
      return c.html(renderPill(3));
    }
    case 4: {
      // License rules: preserve the existing JSON shape, just rewrite each
      // license key to either its in-scope outcome or 'excluded'.
      const existing = getJson<Record<string, unknown>>(KEYS.icpLicenseRules, {});
      const next: Record<string, unknown> = { ...existing };
      // Default in-scope outcomes per license type — mirrors migration 002.
      const inScopeDefaults: Record<string, unknown> = {
        medicaid: { any_state: 'primary_icp' },
        medicare: { in_priority_states: 'secondary_icp', else: 'pending_review' },
        mixed: { in_priority_states: 'secondary_icp', else: 'pending_review' },
        private_pay: { any_state: 'primary_icp' },
      };
      for (const l of LICENSE_TYPES) {
        const checked = readBoolFromBody(body, `icp_license_${l.key}`);
        if (checked) {
          // Restore prior in-scope value if it was excluded; else use default.
          if (existing[l.key] === 'excluded' || existing[l.key] === undefined) {
            next[l.key] = inScopeDefaults[l.key] ?? { any_state: 'primary_icp' };
          } else {
            next[l.key] = existing[l.key];
          }
        } else {
          next[l.key] = 'excluded';
        }
      }
      setJson(KEYS.icpLicenseRules, next);

      // Service types: anything checked → in-scope, unchecked → excluded.
      const inScope: string[] = [];
      const excluded: string[] = [];
      for (const s of SERVICE_TYPES) {
        if (readBoolFromBody(body, `icp_service_${s.key}`)) {
          inScope.push(s.key);
        } else {
          excluded.push(s.key);
        }
      }
      setJson(KEYS.icpServiceTypes, inScope);
      setJson(KEYS.icpExcludedServiceTypes, excluded);
      invalidateIcpRules();
      return c.html(renderPill(4));
    }
    case 5: {
      const states: string[] = [];
      for (const st of ALL_STATES) {
        if (readBoolFromBody(body, `state_${st}`)) states.push(st);
      }
      setJson(KEYS.icpPriorityStates, states);
      invalidateIcpRules();
      return c.html(renderPill(5));
    }
    case 6: {
      setNumber(KEYS.quotaIcpPerDay, readNumberFromBody(body, 'quota_icp_per_day', 100));
      setNumber(
        KEYS.quotaServicePerDay,
        readNumberFromBody(body, 'quota_service_per_day', 100),
      );
      return c.html(renderPill(6));
    }
    case 7: {
      setBoolean(KEYS.outputSheetEnabled, readBoolFromBody(body, 'output_sheet_enabled'));
      setBoolean(KEYS.outputApiEnabled, readBoolFromBody(body, 'output_api_enabled'));
      return c.html(renderPill(7));
    }
    case 8: {
      setBoolean(KEYS.aiNarrativeEnabled, readBoolFromBody(body, 'ai_narrative_enabled'));
      return c.html(renderPill(8));
    }
    default:
      return c.html(`<span id="save-pill-0">Unknown section</span>`, 400);
  }
});

export default router;
