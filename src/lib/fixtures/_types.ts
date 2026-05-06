// Shared types for fixture-driven external responses.
// In the prototype, every "Serper / ZenRows / OpenRouter call" reads from one
// of the fixture arrays in this directory. Production swaps the selector
// implementations for real network calls behind the same signatures.

export type Tier = 'hot' | 'warm' | 'long_term';

export type SignalTag =
  | 'owner_age_70_plus'
  | 'owner_age_65_plus'
  | 'hiring_gm'
  | 'review_velocity_spike'
  | 'ad_activity_spike'
  | 'nearby_closed_deal'
  | 'website_change_gm'
  | 'website_change_services'
  | 'linkedin_active_ma'
  | 'linkedin_inactive'
  | 'website_static';

export interface OpenRouterResponse {
  id: string;
  tags: SignalTag[];
  tier: Tier;
  reason: string;
  keySignals: string;
}

export interface SerperResponse {
  id: string;
  business_name: string;
  address: string;
  phone: string;
  review_count: number;
  recent_review_dates: string[]; // ISO YYYY-MM-DD, most recent first
  hours: string;
}

export type ZenrowsSource = 'website' | 'linkedin' | 'google_ads_transparency';

export interface ZenrowsResponse {
  id: string;
  source: ZenrowsSource;
  tag: SignalTag;
  snippet: string;
}
