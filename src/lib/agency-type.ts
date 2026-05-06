// Service-type inference (Stage 1 of the ICP rule).
//
// CSV columns from Clay are inconsistent: some exports tag the agency type
// explicitly ("category", "type", "service"), most don't. When the column
// is present we trust it (with synonym normalization). When it's missing
// we fall back to keyword matching on the agency name. Either way, we
// return a `source` field so the Step-2 review screen can show Joseph
// what was explicit vs. inferred.

export type AgencyType = 'home_care' | 'home_health' | 'hospice' | 'other' | 'unknown';

// Recognized values for an explicit agency-type CSV column.
const TYPE_SYNONYMS: Record<string, AgencyType> = {
  'home care': 'home_care',
  'home_care': 'home_care',
  'homecare': 'home_care',
  'in-home care': 'home_care',
  'in home care': 'home_care',
  'home health': 'home_health',
  'home_health': 'home_health',
  'homehealth': 'home_health',
  'home health agency': 'home_health',
  'hha': 'home_health',
  'skilled nursing': 'home_health',
  'hospice': 'hospice',
  'palliative': 'hospice',
  'assisted living': 'other',
  'assisted_living': 'other',
  'nursing home': 'other',
  'nursing_home': 'other',
  'snf': 'other',
  'hospital': 'other',
  'senior living': 'other',
  'independent living': 'other',
};

// Keyword fallback — order matters: more specific keywords come first so
// "home health" claims its substring before "home care" or "home" can.
const NAME_KEYWORDS: ReadonlyArray<{ keyword: string; type: AgencyType }> = [
  { keyword: 'home health', type: 'home_health' },
  { keyword: 'family health', type: 'home_health' },
  { keyword: 'nursing solutions', type: 'home_health' },
  { keyword: 'skilled nursing', type: 'home_health' },
  { keyword: 'hospice', type: 'hospice' },
  { keyword: 'palliative', type: 'hospice' },
  { keyword: 'home care', type: 'home_care' },
  { keyword: 'in-home', type: 'home_care' },
  { keyword: 'in home', type: 'home_care' },
  { keyword: 'at home', type: 'home_care' },
  { keyword: 'care partners', type: 'home_care' },
  { keyword: 'elder care', type: 'home_care' },
  { keyword: 'in-home services', type: 'home_care' },
  { keyword: 'senior living', type: 'other' },
  { keyword: 'assisted living', type: 'other' },
  { keyword: 'nursing home', type: 'other' },
  { keyword: 'hospital', type: 'other' },
];

export interface InferenceInput {
  agencyTypeRaw?: string | null; // explicit CSV column, if present
  name?: string | null; // agency name — used for keyword fallback
}

export type InferenceSource = 'explicit' | 'inferred_from_name' | 'unknown';

export interface InferenceResult {
  agencyType: AgencyType;
  source: InferenceSource;
}

export const inferAgencyType = (input: InferenceInput): InferenceResult => {
  if (input.agencyTypeRaw) {
    const normalized = input.agencyTypeRaw.trim().toLowerCase();
    const matched = TYPE_SYNONYMS[normalized];
    if (matched) {
      return { agencyType: matched, source: 'explicit' };
    }
  }

  if (input.name) {
    const lower = input.name.toLowerCase();
    for (const { keyword, type } of NAME_KEYWORDS) {
      if (lower.includes(keyword)) {
        return { agencyType: type, source: 'inferred_from_name' };
      }
    }
  }

  return { agencyType: 'unknown', source: 'unknown' };
};
