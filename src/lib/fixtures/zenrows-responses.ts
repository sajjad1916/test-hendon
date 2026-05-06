// Fake ZenRows scraped-page snippets.
// Each fixture is tagged with the signal pattern it implies, so signal
// generators in slice 14 can use the tag directly instead of regex-parsing
// the snippet. The snippet is still real-ish HTML so the fixture feels honest.

import type { ZenrowsResponse } from './_types';

export const ZENROWS_RESPONSES: ZenrowsResponse[] = [
  // ──────────────── website: new GM page (strong signal) ────────────────
  {
    id: 'zen-001',
    source: 'website',
    tag: 'website_change_gm',
    snippet: `<h1>Meet Our Team</h1>
<p>We are pleased to introduce <strong>Karen Martinez</strong>, our new General Manager. Karen brings 18 years of operational leadership in home health and joins us to scale our day-to-day operations as our agency grows.</p>
<p class="meta">Last updated: 12 days ago</p>`,
  },
  {
    id: 'zen-002',
    source: 'website',
    tag: 'website_change_gm',
    snippet: `<h2>Now Hiring: General Manager</h2>
<p>We're looking for an experienced General Manager to oversee day-to-day operations across our two locations. The owner is stepping back from operations after 24 years.</p>
<p>Apply at careers@brightstar-buffalo.com</p>`,
  },
  {
    id: 'zen-003',
    source: 'website',
    tag: 'website_change_gm',
    snippet: `<section class="leadership">
  <article><h3>Founder &amp; CEO</h3><p>James Smith, RN — 28 years in home health</p></article>
  <article><h3>General Manager (NEW)</h3><p>Linda Anderson — joined March 2026</p></article>
</section>`,
  },

  // ──────────────── website: new services page (warm signal) ────────────────
  {
    id: 'zen-004',
    source: 'website',
    tag: 'website_change_services',
    snippet: `<nav class="services">
  <a href="/services/personal-care">Personal Care</a>
  <a href="/services/companion-care">Companion Care</a>
  <a href="/services/skilled-nursing"><span class="badge-new">New</span> Skilled Nursing</a>
</nav>`,
  },
  {
    id: 'zen-005',
    source: 'website',
    tag: 'website_change_services',
    snippet: `<h1>Now offering: Hospice Coordination</h1>
<p>We've expanded our services to include hospice coordination for families navigating end-of-life care. Effective April 2026.</p>`,
  },

  // ──────────────── website: static one-pager (long-term tier) ────────────────
  {
    id: 'zen-006',
    source: 'website',
    tag: 'website_static',
    snippet: `<html><body><h1>Cardinal Home Care</h1><p>Serving Durham since 1998. Call (919) 555-6200.</p>
<address>6200 Tobacco Rd, Durham, NC 27704</address>
<!-- Last modified: 2022-06-14 --></body></html>`,
  },
  {
    id: 'zen-007',
    source: 'website',
    tag: 'website_static',
    snippet: `<h1>Brookside Elder Care</h1><p>Family-owned home care. Newark, NJ.</p>
<p>Phone: 973-555-0350. Email: info@brookside-eldercare.com</p>
<!-- Page last updated: 2021 -->`,
  },
  {
    id: 'zen-008',
    source: 'website',
    tag: 'website_static',
    snippet: `<h1>Harmony Family Health</h1>
<p>Columbus, Ohio's trusted home health provider since 2003.</p>
<p>Hours: Mon–Fri 8 AM – 5 PM</p>`,
  },

  // ──────────────── LinkedIn: active M&A engagement (warm) ────────────────
  {
    id: 'zen-009',
    source: 'linkedin',
    tag: 'linkedin_active_ma',
    snippet: `<div class="profile">
  <h1>Robert Wilson</h1>
  <p class="headline">Founder & CEO at Liberty Home Health</p>
  <p>BS, University at Buffalo, Class of 1979</p>
  <section class="activity">
    <article>Liked: "What home care owners should know before selling" — 4 days ago</article>
    <article>Liked: "M&A trends in healthcare services 2026" — 11 days ago</article>
    <article>Commented: "This is the right framework for thinking about exits." — 19 days ago</article>
  </section>
</div>`,
  },
  {
    id: 'zen-010',
    source: 'linkedin',
    tag: 'linkedin_active_ma',
    snippet: `<div class="profile">
  <h1>Patricia Jackson</h1>
  <p class="headline">Owner at Magnolia Care Partners</p>
  <p>MBA, University of Florida, Class of 1980</p>
  <section class="activity">
    <article>Shared: "Looking forward to my next chapter." — 2 days ago</article>
    <article>Liked: 3 posts about retirement and succession — last 30 days</article>
  </section>
</div>`,
  },

  // ──────────────── LinkedIn: inactive (long-term tier) ────────────────
  {
    id: 'zen-011',
    source: 'linkedin',
    tag: 'linkedin_inactive',
    snippet: `<div class="profile">
  <h1>Michael Brown</h1>
  <p class="headline">Owner at Brookside Elder Care</p>
  <p>BS, Rutgers, Class of 1985</p>
  <section class="activity"><p class="empty">No recent activity in the past 14 months.</p></section>
</div>`,
  },
  {
    id: 'zen-012',
    source: 'linkedin',
    tag: 'linkedin_inactive',
    snippet: `<div class="profile">
  <h1>Linda Davis</h1>
  <p class="headline">Owner / Operator at Cardinal Home Care</p>
  <p>RN, Duke University, Class of 1992</p>
  <section class="activity"><p class="empty">Profile last updated 2 years ago.</p></section>
</div>`,
  },
  {
    id: 'zen-013',
    source: 'linkedin',
    tag: 'linkedin_inactive',
    snippet: `<div class="profile">
  <h1>Profile not found</h1>
  <p>No public LinkedIn profile matched this name + agency combination.</p>
</div>`,
  },

  // ──────────────── Google Ads Transparency: volume spike (warm/hot) ────────────────
  {
    id: 'zen-014',
    source: 'google_ads_transparency',
    tag: 'ad_activity_spike',
    snippet: `<h1>Brand: BrightStar Care of Buffalo</h1>
<p>Active ads in last 30 days: <strong>47</strong></p>
<p>Active ads in trailing 90-day average: <strong>4</strong></p>
<p>First ad seen: 2018-03-15. Most recent campaign launched: 18 days ago.</p>`,
  },
  {
    id: 'zen-015',
    source: 'google_ads_transparency',
    tag: 'ad_activity_spike',
    snippet: `<h1>Brand: Sunrise Home Care of Newark</h1>
<p>Active ads in last 30 days: <strong>28</strong></p>
<p>Active ads in trailing 90-day average: <strong>3</strong></p>
<p>Most recent campaign launched: 9 days ago.</p>`,
  },
  {
    id: 'zen-016',
    source: 'google_ads_transparency',
    tag: 'ad_activity_spike',
    snippet: `<h1>Brand: Heritage Home Health of Phoenix</h1>
<p>Active ads in last 30 days: <strong>38</strong></p>
<p>Active ads in trailing 90-day average: <strong>6</strong></p>`,
  },

  // ──────────────── Google Ads Transparency: zero / static (no signal) ────────────────
  {
    id: 'zen-017',
    source: 'google_ads_transparency',
    tag: 'website_static', // re-using tag for "no signal"
    snippet: `<h1>Brand search: Brookside Elder Care</h1>
<p>No active or historical ads found.</p>`,
  },
  {
    id: 'zen-018',
    source: 'google_ads_transparency',
    tag: 'website_static',
    snippet: `<h1>Brand search: Cardinal Home Care</h1>
<p>No advertiser registered. Likely never run paid search.</p>`,
  },

  // ──────────────── more website variety ────────────────
  {
    id: 'zen-019',
    source: 'website',
    tag: 'website_change_services',
    snippet: `<h2>What's new at Coastal Senior Living</h2>
<ul>
  <li>New: Memory care partnership with St. Joseph's Hospital (April 2026)</li>
  <li>New: Bilingual care coordinators (March 2026)</li>
</ul>`,
  },
  {
    id: 'zen-020',
    source: 'linkedin',
    tag: 'linkedin_active_ma',
    snippet: `<div class="profile">
  <h1>James Wilson</h1>
  <p class="headline">Founder at Pinewood Home Care</p>
  <p>BBA, University of Albany, Class of 1973</p>
  <section class="activity">
    <article>Posted: "After 30 years, thinking a lot about what's next for me and the team." — 8 days ago</article>
    <article>Liked: "5 mistakes home care owners make when selling." — 22 days ago</article>
  </section>
</div>`,
  },
];
