// Pre-written Reason + Key Signals fixtures the classifier picks from.
// Tagged by signal pattern + tier so pickReason() can match against an
// agency's signal set. Mirrors the gym-leads format Zaki demoed at 30:00–32:04.

import type { OpenRouterResponse } from './_types';

export const OPENROUTER_RESPONSES: OpenRouterResponse[] = [
  // ──────────────── HOT ────────────────
  {
    id: 'hot-001',
    tags: ['owner_age_70_plus', 'hiring_gm'],
    tier: 'hot',
    reason:
      'Owner appears 70+ based on LinkedIn graduation year. Agency just posted a General Manager role — classic prep-to-sell signal mix.',
    keySignals: `Owner age (est.): 70+ (graduation year 1973)
Hiring: General Manager — posted 9 days ago on LinkedIn + careers page
Reviews: 240 lifetime, +12 last 90 days
Years in business: 28 (founder still listed as principal)
Lookalike: Closed Won — Pinewood Home Care of Albany`,
  },
  {
    id: 'hot-002',
    tags: ['owner_age_70_plus', 'nearby_closed_deal'],
    tier: 'hot',
    reason:
      'Owner well past retirement age and Hendon just closed a deal three miles away. Strong "neighbor intro" angle.',
    keySignals: `Owner age (est.): 72 (Stanford '74)
Closest Hendon close: 3.2 mi (Bob's Home Care of Cleveland, 2026-Q1)
Reviews: 187 lifetime, steady
Single-location agency, founder still operating
Lookalike: Closed Won — Bob's Home Care of Cleveland`,
  },
  {
    id: 'hot-003',
    tags: ['owner_age_70_plus', 'hiring_gm', 'review_velocity_spike'],
    tier: 'hot',
    reason:
      'Trifecta — 70+ owner, growth signal, and an active GM search. This is what "ready to sell" looks like.',
    keySignals: `Owner age (est.): 71 (LinkedIn class of '75)
Hiring: Operations Manager (Indeed + LinkedIn, 14 days ago)
Reviews: 412 lifetime, +47 last 90 days (1.6× baseline)
Ad activity: stable
Single-location, owner-operated
Lookalike: Closed Won — Coastal Senior Living of Tampa`,
  },
  {
    id: 'hot-004',
    tags: ['owner_age_70_plus'],
    tier: 'hot',
    reason:
      'Owner is well past typical retirement age. Worth a high-touch outreach even with no other signals firing yet.',
    keySignals: `Owner age (est.): 73 (LinkedIn class of '73)
Reviews: 156 lifetime, modest growth
No hiring activity in last 6 months
Single-location agency, founder still operating
Recommendation: lumpy mail`,
  },
  {
    id: 'hot-005',
    tags: ['nearby_closed_deal'],
    tier: 'hot',
    reason:
      'Hendon just closed a deal a few miles from this agency. Internal signal — surface immediately regardless of cooldown.',
    keySignals: `Closest Hendon close: 4.7 mi (Liberty Home Care of Cincinnati, 2026-Q1)
Same county, same Medicaid managed-care contracts
Reviews: 203 lifetime
Owner age unknown — LinkedIn profile not found
Recommendation: introduce as "we just closed your neighbor"`,
  },
  {
    id: 'hot-006',
    tags: ['hiring_gm', 'review_velocity_spike'],
    tier: 'hot',
    reason:
      'Strong growth signal stacked with an operations-prep hire. Classic "owner planning succession" pattern.',
    keySignals: `Hiring: Director of Operations (LinkedIn + careers page, 6 days ago)
Reviews: 318 lifetime, +52 last 90 days (1.8× baseline)
Ad activity: rose from 4 ads/mo to 28 ads/mo (likely new ad agency)
Owner age unknown
Lookalike: Closed Won — Heritage Home Health of Phoenix`,
  },
  {
    id: 'hot-007',
    tags: ['owner_age_65_plus', 'hiring_gm'],
    tier: 'hot',
    reason:
      'Owner in retirement window and visibly preparing the business to run without them. High-conviction warm-to-hot.',
    keySignals: `Owner age (est.): 67 (LinkedIn class of '79)
Hiring: General Manager (LinkedIn, 21 days ago)
Reviews: 198 lifetime, steady
Two-location agency
Lookalike: Closed Won — Magnolia Care Partners of Sarasota`,
  },
  {
    id: 'hot-008',
    tags: ['ad_activity_spike', 'hiring_gm'],
    tier: 'hot',
    reason:
      'Sharp ad-volume jump plus an operations hire suggests a scaling and prepping pattern.',
    keySignals: `Ad activity: 4 → 47 ads/month (likely retained an agency)
Hiring: Operations Manager (careers page, 11 days ago)
Reviews: 224 lifetime, +18 last 90 days
Owner age unknown
Recommendation: outreach within 2 weeks`,
  },
  {
    id: 'hot-009',
    tags: ['website_change_gm', 'nearby_closed_deal'],
    tier: 'hot',
    reason:
      'New "About our team" page just appeared on the website featuring a GM, and Hendon recently closed a nearby deal — two angles on one outreach.',
    keySignals: `Website change: new /about/team page added 12 days ago, GM photo + bio
Closest Hendon close: 8.1 mi (Sunrise Home Care of Newark, 2026-Q1)
Reviews: 165 lifetime
Owner age unknown
Lookalike: Closed Won — Sunrise Home Care of Newark`,
  },
  {
    id: 'hot-010',
    tags: ['owner_age_70_plus', 'ad_activity_spike'],
    tier: 'hot',
    reason:
      '70+ owner running a sudden growth push. Either a final scale before sale, or a "build it for the kids" — both are intro-worthy.',
    keySignals: `Owner age (est.): 74 (LinkedIn class of '72)
Ad activity: 6 → 38 ads/month (new agency engaged)
Reviews: 281 lifetime, +21 last 90 days
Single-location, owner-operated
Recommendation: outreach this week`,
  },

  // ──────────────── WARM ────────────────
  {
    id: 'warm-001',
    tags: ['review_velocity_spike'],
    tier: 'warm',
    reason:
      'Review velocity nearly doubled in the last 90 days. Growth signal — worth an Instantly touch.',
    keySignals: `Reviews: 132 lifetime, +24 last 90 days (1.9× baseline)
No other signals firing yet
Owner age unknown
Single-location agency`,
  },
  {
    id: 'warm-002',
    tags: ['hiring_gm'],
    tier: 'warm',
    reason:
      'Operations-level hire posted recently. On its own a warm signal — worth a check-in.',
    keySignals: `Hiring: Operations Manager (LinkedIn, 17 days ago)
Reviews: 89 lifetime, steady
Owner age unknown
Single-location, founder-operated`,
  },
  {
    id: 'warm-003',
    tags: ['ad_activity_spike'],
    tier: 'warm',
    reason:
      'Ad volume jumped sharply. Likely a new ad agency or a growth push — worth a soft touch.',
    keySignals: `Ad activity: 3 → 22 ads/month
Reviews: 76 lifetime, modest growth
Owner age unknown
Two-location agency`,
  },
  {
    id: 'warm-004',
    tags: ['website_change_services'],
    tier: 'warm',
    reason:
      'New service offerings appeared on the website. Often a precursor to a broader change — worth tracking.',
    keySignals: `Website change: new /services/skilled-nursing page added 9 days ago
Reviews: 104 lifetime
No hiring activity
Owner age unknown`,
  },
  {
    id: 'warm-005',
    tags: ['owner_age_65_plus'],
    tier: 'warm',
    reason:
      'Owner in early retirement window with no other signals yet. Soft Instantly touch, watch for follow-on signals.',
    keySignals: `Owner age (est.): 66 (LinkedIn class of '80)
Reviews: 142 lifetime
No hiring or ad-activity signals
Single-location agency`,
  },
  {
    id: 'warm-006',
    tags: ['linkedin_active_ma'],
    tier: 'warm',
    reason:
      'Owner has been engaging with M&A-related LinkedIn content. Soft signal but worth tracking.',
    keySignals: `LinkedIn activity: liked 3 M&A-related posts in last 30 days
Reviews: 117 lifetime
No hiring signals
Owner age (est.): 60s
Single-location agency`,
  },
  {
    id: 'warm-007',
    tags: ['nearby_closed_deal'],
    tier: 'warm',
    reason:
      'Hendon closed a deal in the same metro a few months back — soft "we know your market" outreach.',
    keySignals: `Closest Hendon close: 18 mi (Trinity Home Care of Long Island, 2025-Q4)
Reviews: 88 lifetime
Owner age unknown
Three-location agency`,
  },
  {
    id: 'warm-008',
    tags: ['review_velocity_spike', 'ad_activity_spike'],
    tier: 'warm',
    reason:
      'Two growth signals stacked. Not a sale-prep pattern, but a healthy operator — worth a touch.',
    keySignals: `Reviews: 211 lifetime, +31 last 90 days (1.5× baseline)
Ad activity: 5 → 18 ads/month
Owner age unknown
No hiring signals`,
  },

  // ──────────────── LONG-TERM ────────────────
  {
    id: 'longterm-001',
    tags: ['linkedin_inactive'],
    tier: 'long_term',
    reason:
      'No firing signals. Owner LinkedIn is dormant. Schedule the standard 6-month touch.',
    keySignals: `LinkedIn: profile exists, no activity in 14+ months
Reviews: 67 lifetime, flat
Owner age unknown
Single-location agency`,
  },
  {
    id: 'longterm-002',
    tags: ['website_static'],
    tier: 'long_term',
    reason:
      'Static one-pager website, no recent changes. No other signals. 6-month touch.',
    keySignals: `Website: 1 page, last modified 3+ years ago
Reviews: 41 lifetime
Owner age unknown
LinkedIn: not found`,
  },
  {
    id: 'longterm-003',
    tags: ['linkedin_inactive', 'website_static'],
    tier: 'long_term',
    reason:
      'Quiet operator — no public-facing signals. Educational-content drip is the move here.',
    keySignals: `LinkedIn: dormant
Website: static, infrequent updates
Reviews: 92 lifetime
Owner age unknown
Two-location agency`,
  },
  {
    id: 'longterm-004',
    tags: [],
    tier: 'long_term',
    reason:
      'No external signals firing. Default 6-month relationship-touch cadence.',
    keySignals: `No active signals detected this cycle
Reviews: 58 lifetime
Owner age unknown
Single-location agency
Recommendation: educational drip`,
  },
  {
    id: 'longterm-005',
    tags: ['linkedin_active_ma'],
    tier: 'long_term',
    reason:
      'Owner engaging with M&A content but otherwise quiet. Tier-up if more signals appear.',
    keySignals: `LinkedIn: liked 1 M&A post, no posting activity
Reviews: 72 lifetime
Owner age (est.): 50s
Single-location agency`,
  },
];
