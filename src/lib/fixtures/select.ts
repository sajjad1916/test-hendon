// Deterministic fixture selectors. Same agency id → same canned response,
// across runs and processes. Production swaps each function for a real
// Serper / OpenRouter / ZenRows call behind the same signature.

import type {
  OpenRouterResponse,
  SerperResponse,
  SignalTag,
  Tier,
  ZenrowsResponse,
  ZenrowsSource,
} from './_types';
import { OPENROUTER_RESPONSES } from './openrouter-responses';
import { SERPER_RESPONSES } from './serper-responses';
import { ZENROWS_RESPONSES } from './zenrows-responses';

// FNV-1a 32-bit. Stable across Node versions; tiny; no deps.
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h;
};

export interface SignalLike {
  type: SignalTag;
}

export const pickReason = (
  signals: SignalLike[],
  tier: Tier,
  agencyId: number,
): OpenRouterResponse => {
  const tags = Array.from(new Set(signals.map((s) => s.type))).sort();
  const inTier = OPENROUTER_RESPONSES.filter((r) => r.tier === tier);
  if (inTier.length === 0) return OPENROUTER_RESPONSES[0] as OpenRouterResponse;

  // Score each candidate by signal-tag overlap. Highest overlap wins.
  // Untagged long-term fixtures score 0 — they're the natural fallback.
  const scored = inTier.map((r) => ({
    fixture: r,
    score: r.tags.filter((t) => tags.includes(t)).length,
  }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  const top = scored
    .filter((s) => s.score === maxScore)
    .map((s) => s.fixture);

  const idx = fnv1a(`${agencyId}|${tags.join(',')}|reason`) % top.length;
  return top[idx] as OpenRouterResponse;
};

export const pickSerper = (agencyId: number): SerperResponse => {
  const idx = fnv1a(`${agencyId}|serper`) % SERPER_RESPONSES.length;
  return SERPER_RESPONSES[idx] as SerperResponse;
};

export const pickZenrows = (
  agencyId: number,
  source: ZenrowsSource,
): ZenrowsResponse => {
  const candidates = ZENROWS_RESPONSES.filter((z) => z.source === source);
  if (candidates.length === 0) {
    return ZENROWS_RESPONSES[0] as ZenrowsResponse;
  }
  const idx = fnv1a(`${agencyId}|zenrows|${source}`) % candidates.length;
  return candidates[idx] as ZenrowsResponse;
};

export type {
  OpenRouterResponse,
  SerperResponse,
  ZenrowsResponse,
  SignalTag,
  Tier,
  ZenrowsSource,
} from './_types';
export { OPENROUTER_RESPONSES, SERPER_RESPONSES, ZENROWS_RESPONSES };
