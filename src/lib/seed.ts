import { db } from '../db';
import {
  PREFIXES,
  SERVICE_NOUNS,
  FIRST_NAMES,
  LAST_NAMES,
  STATE_WEIGHTS,
  CITIES_BY_STATE,
  LICENSE_DISTRIBUTION,
} from './seed-data';
import type { AgencyType } from './agency-type';
import { classifyAgencyWithRules, loadIcpRules } from './icp';
import type { IcpStatus, LicenseType } from './icp';

const TARGET_ROWS = 100;

const NOUN_TO_AGENCY_TYPE: Record<string, AgencyType> = {
  'Home Care': 'home_care',
  'Care Partners': 'home_care',
  'Elder Care': 'home_care',
  'In-Home Services': 'home_care',
  'At Home Care': 'home_care',
  'Home Health': 'home_health',
  'Family Health': 'home_health',
  'Nursing Solutions': 'home_health',
  'Hospice': 'hospice',
  'Senior Living': 'other',
};

const ICP_RULES = loadIcpRules();

const STREET_NAMES = [
  'Main', 'Oak', 'Maple', 'Elm', 'Park', 'Washington',
  'Cedar', 'Pine', 'Lake', 'Hill', 'Birch', 'Spring',
];
const STREET_TYPES = ['St', 'Ave', 'Rd', 'Blvd', 'Way', 'Pkwy'];

const pick = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)] as T;

const weighted = <T extends { weight: number }>(arr: readonly T[]): T => {
  const total = arr.reduce((s, r) => s + r.weight, 0);
  let n = Math.random() * total;
  for (const r of arr) {
    n -= r.weight;
    if (n <= 0) return r;
  }
  return arr[arr.length - 1] as T;
};

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32);

const generateOwnerAge = (): number => {
  const r = Math.random();
  if (r < 0.55) return 50 + Math.floor(Math.random() * 26); // 50–75 (target window)
  if (r < 0.85) return 35 + Math.floor(Math.random() * 15); // 35–49
  return 75 + Math.floor(Math.random() * 6); // 75–80
};

const generatePhone = (): string => {
  const area = 200 + Math.floor(Math.random() * 700);
  const exch = 200 + Math.floor(Math.random() * 700);
  const sub = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `+1${area}${exch}${sub}`;
};

interface SeedAgency {
  name: string;
  domain: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  email: string | null;
  ownerFirst: string;
  ownerLast: string;
  ownerAge: number | null;
  licenseType: LicenseType;
  segment: string;
  agencyType: AgencyType;
  icpStatus: IcpStatus;
  isIcp: number;
}

const buildAgency = (): SeedAgency => {
  const prefix = pick(PREFIXES);
  const noun = pick(SERVICE_NOUNS);
  const state = weighted(STATE_WEIGHTS).state;
  const cities = CITIES_BY_STATE[state] ?? ['Springfield'];
  const city = pick(cities);
  const includeCitySuffix = Math.random() < 0.3;
  const name = includeCitySuffix
    ? `${prefix} ${noun} of ${city}`
    : `${prefix} ${noun}`;
  const domain = `${slug(prefix + noun)}.com`;
  const street = `${100 + Math.floor(Math.random() * 9900)} ${pick(STREET_NAMES)} ${pick(STREET_TYPES)}`;
  const zip = String(10000 + Math.floor(Math.random() * 89999)).padStart(5, '0');
  const licenseType = weighted(LICENSE_DISTRIBUTION).type;
  const segment = `${licenseType}_${slug(noun)}`;
  const agencyType: AgencyType = NOUN_TO_AGENCY_TYPE[noun] ?? 'unknown';
  const icpStatus = classifyAgencyWithRules(
    { agencyType, licenseType, state },
    ICP_RULES,
  );
  const isIcp = icpStatus === 'primary_icp' || icpStatus === 'secondary_icp' ? 1 : 0;
  return {
    name,
    domain,
    street,
    city,
    state,
    zip,
    phone: Math.random() < 0.7 ? generatePhone() : null,
    email: Math.random() < 0.3 ? `info@${domain}` : null,
    ownerFirst: pick(FIRST_NAMES),
    ownerLast: pick(LAST_NAMES),
    ownerAge: Math.random() < 0.55 ? generateOwnerAge() : null,
    licenseType,
    segment,
    agencyType,
    icpStatus,
    isIcp,
  };
};

const generateAgencies = (n: number): SeedAgency[] => {
  const seen = new Set<string>();
  const rows: SeedAgency[] = [];
  let safety = 0;
  while (rows.length < n && safety < n * 20) {
    const a = buildAgency();
    if (seen.has(a.domain)) {
      let i = 2;
      let alt = `${a.domain.replace('.com', '')}${i}.com`;
      while (seen.has(alt)) {
        i += 1;
        alt = `${a.domain.replace('.com', '')}${i}.com`;
      }
      a.domain = alt;
    }
    seen.add(a.domain);
    rows.push(a);
    safety += 1;
  }
  return rows;
};

const insertAgency = db.prepare(`
  INSERT INTO agencies (
    name, domain, street, city, state, zip, country, phone, email,
    owner_first_name, owner_last_name, owner_age, license_type, segment,
    agency_type, icp_status, is_icp, source
  ) VALUES (
    @name, @domain, @street, @city, @state, @zip, 'US', @phone, @email,
    @owner_first, @owner_last, @owner_age, @license_type, @segment,
    @agency_type, @icp_status, @is_icp, 'seed'
  )
`);

const insertUpload = db.prepare(`
  INSERT INTO uploads (
    file_hash, filename, size_bytes, uploaded_by, status, conflict_mode,
    row_count_in, row_count_inserted, row_count_updated, row_count_errors,
    icp_pass_count
  ) VALUES (
    @file_hash, @filename, @size_bytes, @uploaded_by, 'complete', 'replace',
    @row_count_in, @row_count_inserted, 0, 0, @icp_pass_count
  )
`);

interface SeedResult {
  count: number;
  icpPass: number;
  primary: number;
  secondary: number;
  excluded: number;
  pending: number;
}

const seedOnce = db.transaction((): SeedResult => {
  db.exec('DELETE FROM agencies; DELETE FROM uploads;');
  const agencies = generateAgencies(TARGET_ROWS);
  for (const a of agencies) {
    insertAgency.run({
      name: a.name,
      domain: a.domain,
      street: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
      phone: a.phone,
      email: a.email,
      owner_first: a.ownerFirst,
      owner_last: a.ownerLast,
      owner_age: a.ownerAge,
      license_type: a.licenseType,
      segment: a.segment,
      agency_type: a.agencyType,
      icp_status: a.icpStatus,
      is_icp: a.isIcp,
    });
  }
  const icpPass = agencies.filter((a) => a.isIcp === 1).length;
  const primary = agencies.filter((a) => a.icpStatus === 'primary_icp').length;
  const secondary = agencies.filter((a) => a.icpStatus === 'secondary_icp').length;
  const excluded = agencies.filter((a) => a.icpStatus === 'excluded').length;
  const pending = agencies.filter((a) => a.icpStatus === 'pending_review').length;
  insertUpload.run({
    file_hash: `seed-${new Date().toISOString().slice(0, 10)}`,
    filename: 'hendon-tam-seed.csv',
    size_bytes: 87432,
    uploaded_by: 'system (seed)',
    row_count_in: agencies.length,
    row_count_inserted: agencies.length,
    icp_pass_count: icpPass,
  });
  return { count: agencies.length, icpPass, primary, secondary, excluded, pending };
});

const result = seedOnce();
console.log(
  `[seed] inserted ${result.count} agencies — primary ${result.primary} · secondary ${result.secondary} · excluded ${result.excluded} · pending ${result.pending} · 1 uploads row`,
);
