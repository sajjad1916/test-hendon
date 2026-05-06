// ICP rule engine — Stage 1 (service type) + Stage 2 (license + location).
// Reads rules from the `settings` table seeded in migration 002. Cached at
// module load; call invalidateIcpRules() after a settings update to refresh.

import { db } from '../db';
import type { AgencyType } from './agency-type';

export type LicenseType =
  | 'medicaid'
  | 'medicare'
  | 'mixed'
  | 'private_pay'
  | 'unknown';

export type IcpStatus =
  | 'primary_icp'
  | 'secondary_icp'
  | 'pending_review'
  | 'excluded';

export interface IcpInput {
  agencyType: AgencyType;
  licenseType: LicenseType;
  state: string;
}

export interface IcpRules {
  priorityStates: Set<string>;
  serviceTypes: Set<string>;
  excludedServiceTypes: Set<string>;
}

const DEFAULT_RULES: IcpRules = {
  priorityStates: new Set(['NY', 'NJ', 'FL', 'TX', 'CA']),
  serviceTypes: new Set(['home_care', 'home_health', 'hospice']),
  excludedServiceTypes: new Set(['assisted_living', 'nursing_home', 'hospital', 'other']),
};

let cachedRules: IcpRules | null = null;

const parseStringArray = (raw: string | undefined, fallback: string[]): string[] => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : fallback;
  } catch {
    return fallback;
  }
};

export const loadIcpRules = (): IcpRules => {
  if (cachedRules) return cachedRules;
  const rows = db
    .prepare('SELECT key, value FROM settings WHERE key LIKE ?')
    .all('icp.%') as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  cachedRules = {
    priorityStates: new Set(
      parseStringArray(map.get('icp.priority_states'), [...DEFAULT_RULES.priorityStates]),
    ),
    serviceTypes: new Set(
      parseStringArray(map.get('icp.service_types'), [...DEFAULT_RULES.serviceTypes]),
    ),
    excludedServiceTypes: new Set(
      parseStringArray(
        map.get('icp.excluded_service_types'),
        [...DEFAULT_RULES.excludedServiceTypes],
      ),
    ),
  };
  return cachedRules;
};

// Reset the cache when settings change (the toggle panel calls this).
export const invalidateIcpRules = (): void => {
  cachedRules = null;
};

// Pure function — useful for unit-style verification without a DB.
export const classifyAgencyWithRules = (
  input: IcpInput,
  rules: IcpRules,
): IcpStatus => {
  // Stage 1 — service-type gate.
  // Private-pay always excluded regardless of service type.
  if (input.licenseType === 'private_pay') return 'excluded';
  if (rules.excludedServiceTypes.has(input.agencyType)) return 'excluded';
  if (!rules.serviceTypes.has(input.agencyType)) {
    // 'unknown' agency_type → pending review (Joseph decides);
    // anything else not on the in-scope list → excluded.
    return input.agencyType === 'unknown' ? 'pending_review' : 'excluded';
  }
  if (input.licenseType === 'unknown') return 'pending_review';

  // Stage 2 — license + location.
  if (input.licenseType === 'medicaid') return 'primary_icp';
  // medicare or mixed
  return rules.priorityStates.has(input.state) ? 'secondary_icp' : 'pending_review';
};

// Convenience wrapper: loads cached rules from the DB and classifies.
export const classifyAgency = (input: IcpInput): IcpStatus =>
  classifyAgencyWithRules(input, loadIcpRules());
