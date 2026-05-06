// Static name parts and geographic data used by the synthetic seeder.

export const PREFIXES = [
  'Sunrise',
  'Liberty',
  'Coastal',
  'Heritage',
  'Evergreen',
  'Beacon',
  'Comfort',
  'Compassion',
  'Golden',
  'Harmony',
  'Cardinal',
  'Magnolia',
  'Lakeside',
  'Pinewood',
  'Riverside',
  'Maple',
  'Oakhaven',
  'Silverleaf',
  'Bayview',
  'Trinity',
  'Hearthstone',
  'Brookside',
  'Willow',
  'Cypress',
];

export const SERVICE_NOUNS = [
  'Home Care',
  'Senior Living',
  'Family Health',
  'Hospice',
  'Home Health',
  'Care Partners',
  'Elder Care',
  'In-Home Services',
  'Nursing Solutions',
  'At Home Care',
];

// Owner first / last names — small but varied; combined randomly.
export const FIRST_NAMES = [
  'Maria', 'James', 'Linda', 'Robert', 'Patricia', 'Michael', 'Susan', 'David',
  'Karen', 'William', 'Nancy', 'Richard', 'Lisa', 'Charles', 'Betty', 'Thomas',
  'Helen', 'Daniel', 'Sandra', 'Paul', 'Donna', 'Mark', 'Carol', 'George',
  'Ruth', 'Steven', 'Sharon', 'Kenneth', 'Michelle', 'Edward', 'Laura',
  'Brian', 'Sarah', 'Ronald', 'Kimberly', 'Anthony', 'Deborah', 'Kevin',
  'Dorothy', 'Jason',
];

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson',
  'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez',
  'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis',
  'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres',
  'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall',
];

// Weighted state distribution: priority states first, totaling ~80% of rows,
// rest spread across secondary states.
export const STATE_WEIGHTS: ReadonlyArray<{ state: string; weight: number }> = [
  { state: 'NY', weight: 18 },
  { state: 'NJ', weight: 14 },
  { state: 'FL', weight: 14 },
  { state: 'TX', weight: 14 },
  { state: 'CA', weight: 14 },
  { state: 'PA', weight: 6 },
  { state: 'OH', weight: 5 },
  { state: 'IL', weight: 5 },
  { state: 'GA', weight: 4 },
  { state: 'AZ', weight: 3 },
  { state: 'NC', weight: 3 },
];

// Plausible cities for each state — used when generating addresses.
export const CITIES_BY_STATE: Record<string, string[]> = {
  NY: ['Brooklyn', 'Buffalo', 'Rochester', 'Yonkers', 'Albany', 'Syracuse'],
  NJ: ['Newark', 'Jersey City', 'Paterson', 'Edison', 'Trenton', 'Camden'],
  FL: ['Miami', 'Tampa', 'Orlando', 'Jacksonville', 'St. Petersburg', 'Hialeah'],
  TX: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso'],
  CA: ['Los Angeles', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Long Beach'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie'],
  OH: ['Cleveland', 'Columbus', 'Cincinnati', 'Toledo'],
  IL: ['Chicago', 'Aurora', 'Naperville', 'Joliet'],
  GA: ['Atlanta', 'Augusta', 'Savannah', 'Columbus'],
  AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham'],
};

// Priority states for Medicare ICP eligibility (per PRD).
export const MEDICARE_PRIORITY_STATES = new Set(['NY', 'NJ', 'FL', 'TX', 'CA']);

export const LICENSE_DISTRIBUTION: ReadonlyArray<{
  type: 'medicaid' | 'medicare' | 'mixed' | 'private_pay' | 'unknown';
  weight: number;
}> = [
  { type: 'medicaid', weight: 60 },
  { type: 'medicare', weight: 20 },
  { type: 'mixed', weight: 10 },
  { type: 'private_pay', weight: 5 },
  { type: 'unknown', weight: 5 },
];
