/**
 * The ranking weight catalogue.
 *
 * Pure data and types, deliberately free of any database or cache import, so the
 * policy — what may be tuned and within what bounds — can be tested without
 * infrastructure running. `weights.ts` reads and writes these; this file just
 * declares them.
 */

export interface WeightSpec {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  group: 'signal' | 'quality' | 'diversity' | 'exploration' | 'penalty' | 'retrieval';
  description: string;
}

/**
 * The defaults, used to seed the table and as a fallback if it is empty.
 *
 * The signal weights are ordered by how much deliberate effort each action takes:
 * a save or a share costs the viewer something, a watch costs nothing.
 */
export const WEIGHT_DEFAULTS: readonly WeightSpec[] = [
  // Positive engagement
  { key: 'w_watch', label: 'Watch probability', value: 1.0, min: 0, max: 5, group: 'signal',
    description: 'How much predicted watch probability contributes.' },
  { key: 'w_completion', label: 'Completion', value: 1.4, min: 0, max: 5, group: 'signal',
    description: 'Finishing a video is the strongest passive signal.' },
  { key: 'w_rewatch', label: 'Rewatch', value: 1.6, min: 0, max: 5, group: 'signal',
    description: 'Watching again is rare and deliberate.' },
  { key: 'w_like', label: 'Like', value: 1.2, min: 0, max: 5, group: 'signal',
    description: 'Cheap to give, so weighted below saves and shares.' },
  { key: 'w_comment', label: 'Comment', value: 1.8, min: 0, max: 5, group: 'signal',
    description: 'Costs real effort.' },
  { key: 'w_share', label: 'Share', value: 2.2, min: 0, max: 5, group: 'signal',
    description: 'The viewer put their own reputation behind it.' },
  { key: 'w_save', label: 'Save', value: 2.0, min: 0, max: 5, group: 'signal',
    description: 'An explicit intention to return.' },
  { key: 'w_follow', label: 'Follow', value: 2.5, min: 0, max: 5, group: 'signal',
    description: 'The strongest signal a single video can produce.' },
  { key: 'w_profile_visit', label: 'Profile visit', value: 0.8, min: 0, max: 5, group: 'signal',
    description: 'Curiosity about the creator.' },

  // Context
  { key: 'w_interest_match', label: 'Interest match', value: 2.0, min: 0, max: 5, group: 'signal',
    description: 'Agreement with the viewer’s interest profile.' },
  { key: 'w_creator_affinity', label: 'Creator affinity', value: 1.5, min: 0, max: 5, group: 'signal',
    description: 'Past relationship with this creator.' },
  { key: 'w_freshness', label: 'Freshness', value: 1.0, min: 0, max: 5, group: 'quality',
    description: 'Recency boost, decaying over hours.' },
  { key: 'w_trending', label: 'Trending', value: 0.8, min: 0, max: 5, group: 'quality',
    description: 'Current momentum across the platform.' },

  // Quality — deliberately small, per ADR-011.
  { key: 'w_quality', label: 'Technical quality', value: 0.3, min: 0, max: 1, group: 'quality',
    description: 'Capped low on purpose: a cheap camera must not decide who gets an audience.' },

  // Penalties
  { key: 'p_quick_skip', label: 'Quick skip penalty', value: 2.0, min: 0, max: 10, group: 'penalty',
    description: 'Predicted quick skip.' },
  { key: 'p_not_interested', label: 'Not interested penalty', value: 6.0, min: 0, max: 20, group: 'penalty',
    description: 'Explicit rejection outweighs any positive.' },
  { key: 'p_hide', label: 'Hide penalty', value: 8.0, min: 0, max: 20, group: 'penalty',
    description: 'Hiding a creator is close to a permanent no.' },
  { key: 'p_report', label: 'Report penalty', value: 12.0, min: 0, max: 30, group: 'penalty',
    description: 'The strongest negative available.' },
  { key: 'p_repetition', label: 'Repetition penalty', value: 3.0, min: 0, max: 10, group: 'penalty',
    description: 'Applied to a video the viewer has already been shown.' },

  // Diversity
  { key: 'd_creator_window', label: 'Creator spacing', value: 4, min: 1, max: 20, group: 'diversity',
    description: 'Minimum slots between two videos from the same creator.' },
  { key: 'd_category_max_share', label: 'Category share cap', value: 0.4, min: 0.1, max: 1, group: 'diversity',
    description: 'Largest share of a page one category may occupy.' },
  { key: 'd_strength', label: 'Diversity strength', value: 1.0, min: 0, max: 3, group: 'diversity',
    description: 'How hard diversity is enforced against relevance.' },

  // Exploration
  { key: 'x_new_creator_rate', label: 'New creator exploration', value: 0.10, min: 0, max: 0.5,
    group: 'exploration',
    description: 'Share of slots reserved for creators without an established audience (ADR-010).' },
  { key: 'x_fresh_video_rate', label: 'Fresh video testing', value: 0.15, min: 0, max: 0.5,
    group: 'exploration',
    description: 'Share of slots reserved for recently published, under-tested videos.' },
  { key: 'x_discovery_rate', label: 'Discovery', value: 0.05, min: 0, max: 0.3, group: 'exploration',
    description: 'Deliberate out-of-profile exploration, so a profile cannot close in on itself.' },

  // Retrieval
  { key: 'r_candidate_pool', label: 'Candidate pool size', value: 800, min: 50, max: 5000,
    group: 'retrieval', description: 'Candidates retrieved before scoring.' },
  { key: 'r_per_pool_limit', label: 'Per-pool limit', value: 150, min: 10, max: 1000,
    group: 'retrieval', description: 'Maximum candidates from any single pool.' },
];

export type Weights = Record<string, number>;

export const SPEC_BY_KEY = new Map(WEIGHT_DEFAULTS.map((w) => [w.key, w]));

export const DEFAULT_MAP: Weights = Object.fromEntries(
  WEIGHT_DEFAULTS.map((w) => [w.key, w.value]),
);
