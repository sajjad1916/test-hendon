// Fake Google Maps responses (what Serper would return).
// The signal generator for review velocity reads `recent_review_dates` to
// compute spikes vs. trailing baseline. Mix is deliberate:
//   - ~30% have a clear velocity spike (clustered recent dates, high count)
//   - ~30% have steady moderate growth
//   - ~30% are flat / low-volume
//   - ~10% are brand-new (spike on a low base — should NOT fire as a signal)
// Selector keys these to agencies deterministically by agency.id.

import type { SerperResponse } from './_types';

export const SERPER_RESPONSES: SerperResponse[] = [
  // ──────────────── velocity spike (high lifetime count, clustered recent) ────────────────
  {
    id: 'serper-001',
    business_name: 'BrightStar Care',
    address: '1024 Main St, Buffalo, NY 14202',
    phone: '+17165551024',
    review_count: 412,
    recent_review_dates: ['2026-05-04', '2026-05-02', '2026-05-01', '2026-04-29', '2026-04-28'],
    hours: 'Open 24 hours',
  },
  {
    id: 'serper-002',
    business_name: 'Sunrise Home Care of Newark',
    address: '88 Broad St, Newark, NJ 07102',
    phone: '+19735552088',
    review_count: 318,
    recent_review_dates: ['2026-05-05', '2026-05-03', '2026-04-30', '2026-04-27', '2026-04-25'],
    hours: 'Mon–Fri 8 AM – 6 PM',
  },
  {
    id: 'serper-003',
    business_name: 'Coastal Senior Living of Tampa',
    address: '4407 Kennedy Blvd, Tampa, FL 33609',
    phone: '+18135554407',
    review_count: 281,
    recent_review_dates: ['2026-05-04', '2026-05-02', '2026-04-30', '2026-04-26', '2026-04-22'],
    hours: 'Open 24 hours',
  },
  {
    id: 'serper-004',
    business_name: 'Liberty Home Health',
    address: '212 5th Ave, Brooklyn, NY 11215',
    phone: '+17185550212',
    review_count: 240,
    recent_review_dates: ['2026-05-06', '2026-05-04', '2026-05-01', '2026-04-29', '2026-04-26'],
    hours: 'Mon–Sat 7 AM – 7 PM',
  },
  {
    id: 'serper-005',
    business_name: 'Heritage Home Health of Phoenix',
    address: '8800 N Central Ave, Phoenix, AZ 85020',
    phone: '+16025558800',
    review_count: 224,
    recent_review_dates: ['2026-05-03', '2026-05-01', '2026-04-29', '2026-04-26', '2026-04-23'],
    hours: 'Mon–Fri 8 AM – 5 PM',
  },

  // ──────────────── steady moderate growth ────────────────
  {
    id: 'serper-006',
    business_name: 'Magnolia Care Partners of Sarasota',
    address: '2200 S Tamiami Trail, Sarasota, FL 34239',
    phone: '+19415552200',
    review_count: 198,
    recent_review_dates: ['2026-05-01', '2026-04-22', '2026-04-14', '2026-04-04', '2026-03-26'],
    hours: 'Open 24 hours',
  },
  {
    id: 'serper-007',
    business_name: 'Trinity Home Care of Long Island',
    address: '350 Old Country Rd, Westbury, NY 11590',
    phone: '+15165550350',
    review_count: 165,
    recent_review_dates: ['2026-04-28', '2026-04-19', '2026-04-10', '2026-04-01', '2026-03-22'],
    hours: 'Mon–Fri 8 AM – 6 PM',
  },
  {
    id: 'serper-008',
    business_name: 'Pinewood Home Care of Albany',
    address: '900 Washington Ave, Albany, NY 12203',
    phone: '+15185550900',
    review_count: 156,
    recent_review_dates: ['2026-04-30', '2026-04-21', '2026-04-13', '2026-04-03', '2026-03-25'],
    hours: 'Mon–Sat 7 AM – 7 PM',
  },
  {
    id: 'serper-009',
    business_name: 'Bayview Senior Living of San Diego',
    address: '4500 Mission Bay Dr, San Diego, CA 92109',
    phone: '+16195554500',
    review_count: 142,
    recent_review_dates: ['2026-04-26', '2026-04-17', '2026-04-08', '2026-03-30', '2026-03-21'],
    hours: 'Open 24 hours',
  },
  {
    id: 'serper-010',
    business_name: 'Compassion Nursing Solutions',
    address: '600 W Adams St, Chicago, IL 60661',
    phone: '+13125550600',
    review_count: 132,
    recent_review_dates: ['2026-04-25', '2026-04-15', '2026-04-05', '2026-03-26', '2026-03-15'],
    hours: 'Mon–Fri 8 AM – 5 PM',
  },

  // ──────────────── flat / low volume ────────────────
  {
    id: 'serper-011',
    business_name: 'Harmony Family Health',
    address: '1450 W Broad St, Columbus, OH 43222',
    phone: '+16145551450',
    review_count: 89,
    recent_review_dates: ['2026-04-12', '2026-03-18', '2026-02-22', '2026-01-30', '2025-12-28'],
    hours: 'Mon–Fri 8 AM – 5 PM',
  },
  {
    id: 'serper-012',
    business_name: 'Beacon At Home Care',
    address: '775 Peachtree St, Atlanta, GA 30308',
    phone: '+14045550775',
    review_count: 76,
    recent_review_dates: ['2026-04-08', '2026-03-12', '2026-02-15', '2026-01-20', '2025-12-22'],
    hours: 'Mon–Sat 8 AM – 6 PM',
  },
  {
    id: 'serper-013',
    business_name: 'Cardinal Home Care',
    address: '6200 Tobacco Rd, Durham, NC 27704',
    phone: '+19195556200',
    review_count: 67,
    recent_review_dates: ['2026-04-05', '2026-03-09', '2026-02-10', '2026-01-12', '2025-12-15'],
    hours: 'Mon–Fri 8 AM – 5 PM',
  },
  {
    id: 'serper-014',
    business_name: 'Hearthstone Hospice of Pittsburgh',
    address: '1200 Forbes Ave, Pittsburgh, PA 15219',
    phone: '+14125551200',
    review_count: 58,
    recent_review_dates: ['2026-04-02', '2026-03-04', '2026-02-04', '2026-01-06', '2025-12-08'],
    hours: 'Open 24 hours',
  },
  {
    id: 'serper-015',
    business_name: 'Brookside Elder Care',
    address: '350 Spring St, Newark, NJ 07105',
    phone: '+19735550350',
    review_count: 41,
    recent_review_dates: ['2026-03-25', '2026-02-20', '2026-01-15', '2025-12-10', '2025-11-05'],
    hours: 'Mon–Fri 9 AM – 5 PM',
  },
  {
    id: 'serper-016',
    business_name: 'Willow In-Home Services',
    address: '88 Rt 1, Edison, NJ 08817',
    phone: '+17325550088',
    review_count: 38,
    recent_review_dates: ['2026-03-20', '2026-02-15', '2026-01-08', '2025-12-02', '2025-10-28'],
    hours: 'Mon–Fri 8 AM – 5 PM',
  },

  // ──────────────── brand-new / low-base spike (should NOT fire) ────────────────
  {
    id: 'serper-017',
    business_name: 'Cypress Home Care (new)',
    address: '12 Live Oak Ln, Houston, TX 77002',
    phone: '+17135550012',
    review_count: 7,
    recent_review_dates: ['2026-05-05', '2026-05-04', '2026-05-02', '2026-04-30', '2026-04-28'],
    hours: 'Mon–Fri 9 AM – 5 PM',
  },
  {
    id: 'serper-018',
    business_name: 'Silverleaf Care (new)',
    address: '500 Oak St, Austin, TX 78704',
    phone: '+15125550500',
    review_count: 5,
    recent_review_dates: ['2026-05-03', '2026-05-01', '2026-04-28', '2026-04-25', '2026-04-22'],
    hours: 'By appointment',
  },

  // ──────────────── high-count steady (no spike, but worth tracking) ────────────────
  {
    id: 'serper-019',
    business_name: 'Evergreen Home Health of Dallas',
    address: '7700 Forest Ln, Dallas, TX 75230',
    phone: '+12145557700',
    review_count: 211,
    recent_review_dates: ['2026-04-27', '2026-04-18', '2026-04-09', '2026-03-31', '2026-03-22'],
    hours: 'Open 24 hours',
  },
  {
    id: 'serper-020',
    business_name: 'Lakeside Senior Living of Chicago',
    address: '2100 Lake Shore Dr, Chicago, IL 60614',
    phone: '+13125552100',
    review_count: 187,
    recent_review_dates: ['2026-04-29', '2026-04-20', '2026-04-11', '2026-04-02', '2026-03-24'],
    hours: 'Open 24 hours',
  },
];
