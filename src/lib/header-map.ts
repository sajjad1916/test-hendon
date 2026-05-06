// Maps Clay-style CSV headers to the prototype's recognized field names.
// Only `company_name` and `company_url` are required (locked-in plan
// refinement #2 — every other column is optional). Unrecognized columns
// are reported back to the caller, which preserves them in
// `agencies.metadata` JSON downstream rather than dropping them.

export type RecognizedField =
  | 'company_name'
  | 'company_url'
  | 'company_linkedin_url'
  | 'company_description'
  | 'owner_name'
  | 'owner_first_name'
  | 'owner_last_name'
  | 'owner_linkedin_url'
  | 'owner_age'
  | 'email'
  | 'phone'
  | 'license_type'
  | 'agency_type'
  | 'street'
  | 'city'
  | 'state'
  | 'zip'
  | 'address'
  | 'segment';

export const REQUIRED_FIELDS: ReadonlyArray<RecognizedField> = [
  'company_name',
  'company_url',
];

// Header → field. Keys are pre-normalized (lowercase, single-spaced).
const SYNONYMS: Record<string, RecognizedField> = {
  // company_name
  'business name': 'company_name',
  'company name': 'company_name',
  'company': 'company_name',
  'org name': 'company_name',
  'organization': 'company_name',
  'agency': 'company_name',
  'agency name': 'company_name',
  'name': 'company_name',
  'dba': 'company_name',

  // company_url
  'website': 'company_url',
  'site': 'company_url',
  'domain': 'company_url',
  'url': 'company_url',
  'company url': 'company_url',
  'company website': 'company_url',
  'web': 'company_url',
  'homepage': 'company_url',

  // company_linkedin_url
  'linkedin': 'company_linkedin_url',
  'company linkedin': 'company_linkedin_url',
  'company linkedin url': 'company_linkedin_url',
  'linkedin url': 'company_linkedin_url',
  'linkedin profile': 'company_linkedin_url',

  // company_description
  'description': 'company_description',
  'about': 'company_description',
  'summary': 'company_description',
  'company description': 'company_description',
  'bio': 'company_description',

  // owner_name (combined first + last)
  'owner': 'owner_name',
  'owner name': 'owner_name',
  'principal': 'owner_name',
  'ceo': 'owner_name',
  'founder': 'owner_name',
  'president': 'owner_name',
  'contact name': 'owner_name',

  // owner_first_name + owner_last_name
  'first name': 'owner_first_name',
  'first': 'owner_first_name',
  'owner first name': 'owner_first_name',
  'last name': 'owner_last_name',
  'last': 'owner_last_name',
  'owner last name': 'owner_last_name',

  // owner_linkedin_url
  'owner linkedin': 'owner_linkedin_url',
  'owner linkedin url': 'owner_linkedin_url',
  'owner profile': 'owner_linkedin_url',
  'principal linkedin': 'owner_linkedin_url',

  // owner_age
  'owner age': 'owner_age',
  'age': 'owner_age',

  // email
  'email': 'email',
  'email address': 'email',
  'contact email': 'email',

  // phone
  'phone': 'phone',
  'phone number': 'phone',
  'contact phone': 'phone',
  'tel': 'phone',
  'telephone': 'phone',

  // license_type
  'license': 'license_type',
  'license type': 'license_type',
  'reimbursement': 'license_type',
  'reimbursement type': 'license_type',
  'payer': 'license_type',
  'payer mix': 'license_type',

  // agency_type
  'type': 'agency_type',
  'category': 'agency_type',
  'service': 'agency_type',
  'service type': 'agency_type',
  'agency type': 'agency_type',
  'business type': 'agency_type',

  // address fields
  'street': 'street',
  'address line 1': 'street',
  'address1': 'street',
  'street address': 'street',
  'city': 'city',
  'state': 'state',
  'province': 'state',
  'region': 'state',
  'zip': 'zip',
  'zip code': 'zip',
  'postal code': 'zip',
  'postcode': 'zip',
  'address': 'address',
  'full address': 'address',
  'mailing address': 'address',

  // segment
  'segment': 'segment',
};

export const normalizeHeader = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    // collapse underscores, hyphens, dots, and runs of spaces into single spaces
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ');

export interface HeaderMapResult {
  // colIndex → recognized field, or null for unrecognized columns
  fields: (RecognizedField | null)[];
  // mapping of raw → recognized for quick lookup; only populated for matches
  recognized: Record<string, RecognizedField>;
  // unrecognized headers (caller preserves them in metadata downstream)
  unmapped: string[];
  // duplicate-mapping conflicts (same field claimed twice) — reported, not auto-resolved
  conflicts: RecognizedField[];
  // required fields not found in this CSV
  missingRequired: RecognizedField[];
}

export const mapHeaders = (rawHeaders: string[]): HeaderMapResult => {
  const fields: (RecognizedField | null)[] = [];
  const recognized: Record<string, RecognizedField> = {};
  const unmapped: string[] = [];
  const seen = new Map<RecognizedField, number>();
  const conflicts: RecognizedField[] = [];

  for (const raw of rawHeaders) {
    const norm = normalizeHeader(raw);
    const mapped = SYNONYMS[norm];
    if (mapped) {
      const count = (seen.get(mapped) ?? 0) + 1;
      seen.set(mapped, count);
      if (count === 2) conflicts.push(mapped); // record once, on the first dup
      fields.push(mapped);
      recognized[raw] = mapped;
    } else {
      fields.push(null);
      unmapped.push(raw);
    }
  }

  const missingRequired = REQUIRED_FIELDS.filter((f) => !seen.has(f));

  return { fields, recognized, unmapped, conflicts, missingRequired };
};
