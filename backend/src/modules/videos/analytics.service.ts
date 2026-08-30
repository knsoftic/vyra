/**
 * Creator analytics.
 *
 * Everything here is measured. There is no estimation, no extrapolation and no
 * "approximately" — every number is a count or an average of rows the platform
 * actually recorded, and a creator with no views sees zeros rather than a
 * plausible-looking chart.
 *
 * Two rules the numbers follow:
 *
 * **Watch time comes from watch events, not from view counts.** A view is an
 * impression that started playing; watch time is how long it actually played.
 * Multiplying one by an assumed average would produce a number that looks like
 * data and is not.
 *
 * **A rate with no denominator is not shown as zero — it is shown as null.**
 * "0% completion" and "nobody has watched this yet" are different statements,
 * and a new creator deserves the second one.
 */

import { query, queryOne } from '../../core/db.ts';
import { storage } from '../../core/storage.ts';

export interface SeriesPoint {
  day: string;
  value: number;
}

export interface TopVideo {
  id: string;
  caption: string | null;
  posterUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  watchMinutes: number;
  publishedAt: string | null;
}

export interface CreatorAnalytics {
  /** How many days these figures cover. */
  days: number;

  followers: number;
  followerGrowth: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileVisits: number;
  giftCoins: number;

  watchTimeHours: number;
  /** Null until at least one person has watched something. */
  avgWatchSeconds: number | null;
  completionRate: number | null;
  rewatchRate: number | null;

  viewsSeries: SeriesPoint[];
  followerSeries: SeriesPoint[];
  watchMinutesSeries: SeriesPoint[];

  /** Where the views came from — the creator's own categories, by watch time. */
  categories: { label: string; percent: number }[];
  /** How people reached the videos: For You, Following, search, profile… */
  sources: { label: string; percent: number }[];

  topVideos: TopVideo[];

  /** True when the creator has published nothing — the screen says so plainly. */
  hasNoVideos: boolean;
}

/**
 * `YYYY-MM-DD` in local time, for a Date or a string.
 *
 * Both sides of every series join go through this. mysql2 returns `DATE(...)`
 * as a JS Date, and formatting the two sides differently is how a chart ends up
 * drawing zeros underneath correct totals.
 */
function dayKey(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fillSeries(rows: { day: unknown; value: unknown }[], days: number): SeriesPoint[] {
  const byDay = new Map(rows.map((r) => [dayKey(r.day), Number(r.value)]));
  const out: SeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(Date.now() - i * 86_400_000));
    out.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}

/** Turns counts into whole percentages that add up to 100. */
function toPercentages(rows: { label: string; weight: number }[]): { label: string; percent: number }[] {
  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  if (total === 0) return [];

  const scaled = rows.map((r) => ({ label: r.label, exact: (r.weight / total) * 100 }));
  const rounded = scaled.map((r) => ({ label: r.label, percent: Math.floor(r.exact) }));

  // Hand the rounding remainder to the largest fractions, so the column always
  // reads as 100 rather than 97 or 103.
  let remainder = 100 - rounded.reduce((sum, r) => sum + r.percent, 0);
  const order = scaled
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    rounded[i]!.percent += 1;
    remainder -= 1;
  }

  return rounded.filter((r) => r.percent > 0);
}

const SOURCE_LABELS: Record<string, string> = {
  for_you: 'For You',
  following: 'Following',
  trending: 'Trending',
  category: 'Categories',
  search: 'Search',
  profile: 'Your profile',
  promoted: 'Promoted',
  sound: 'Sounds',
  hashtag: 'Hashtags',
};

export async function creatorAnalytics(userId: number, days = 28): Promise<CreatorAnalytics> {
  const window = Math.min(Math.max(days, 1), 90);

  const [totals, watch, growth, gifts, visits, viewRows, followRows, watchRows, categoryRows, sourceRows, top, videoCount] =
    await Promise.all([
      // Lifetime totals on the creator's own videos.
      queryOne<{ views: number; likes: number; comments: number; shares: number; saves: number }>(
        `SELECT COALESCE(SUM(view_count),0) AS views, COALESCE(SUM(like_count),0) AS likes,
                COALESCE(SUM(comment_count),0) AS comments, COALESCE(SUM(share_count),0) AS shares,
                COALESCE(SUM(save_count),0) AS saves
           FROM videos WHERE user_id = :userId AND deleted_at IS NULL`,
        { userId },
      ),

      // Watch behaviour in the window. `n` is the denominator for every rate
      // below — without it a rate is undefined, not zero.
      queryOne<{ n: number; watch_ms: number; completions: number; rewatches: number }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(watch_ms),0) AS watch_ms,
                COALESCE(SUM(completed),0) AS completions, COALESCE(SUM(rewatched),0) AS rewatches
           FROM watch_events
          WHERE creator_id = :userId
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
        { userId, window },
      ),

      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM follows
          WHERE followee_id = :userId AND deleted_at IS NULL
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
        { userId, window },
      ),

      queryOne<{ c: number }>(
        `SELECT COALESCE(SUM(coins_to_creator),0) AS c FROM gift_transactions
          WHERE recipient_id = :userId
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
        { userId, window },
      ),

      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM behaviour_events
          WHERE creator_id = :userId AND event = 'profile_visit'
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
        { userId, window },
      ),

      query<{ day: unknown; value: unknown }>(
        `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM watch_events
          WHERE creator_id = :userId
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
          GROUP BY DATE(created_at)`,
        { userId, window },
      ),

      query<{ day: unknown; value: unknown }>(
        `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM follows
          WHERE followee_id = :userId AND deleted_at IS NULL
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
          GROUP BY DATE(created_at)`,
        { userId, window },
      ),

      query<{ day: unknown; value: unknown }>(
        `SELECT DATE(created_at) AS day, ROUND(COALESCE(SUM(watch_ms),0)/60000) AS value
           FROM watch_events
          WHERE creator_id = :userId
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
          GROUP BY DATE(created_at)`,
        { userId, window },
      ),

      // Which of the creator's own categories hold the audience's attention.
      query<{ label: string; weight: number }>(
        `SELECT COALESCE(c.name, 'Uncategorised') AS label,
                COALESCE(SUM(w.watch_ms),0) AS weight
           FROM watch_events w
           JOIN videos v ON v.id = w.video_id
           LEFT JOIN categories c ON c.id = v.category_id
          WHERE w.creator_id = :userId
            AND w.created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
          GROUP BY label
          ORDER BY weight DESC
          LIMIT 6`,
        { userId, window },
      ),

      query<{ label: string; weight: number }>(
        `SELECT feed_source AS label, COUNT(*) AS weight
           FROM watch_events
          WHERE creator_id = :userId
            AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
          GROUP BY feed_source
          ORDER BY weight DESC`,
        { userId, window },
      ),

      query<{
        id: string; caption: string | null; poster_key: string | null;
        views: number; likes: number; comments: number; published_at: Date | null; watch_ms: number;
      }>(
        `SELECT v.public_id AS id, v.caption, v.poster_key, v.view_count AS views,
                v.like_count AS likes, v.comment_count AS comments, v.published_at,
                COALESCE((SELECT SUM(w.watch_ms) FROM watch_events w WHERE w.video_id = v.id), 0) AS watch_ms
           FROM videos v
          WHERE v.user_id = :userId AND v.deleted_at IS NULL AND v.status = 'published'
          ORDER BY v.view_count DESC, v.like_count DESC
          LIMIT 5`,
        { userId },
      ),

      queryOne<{ c: number }>(
        "SELECT COUNT(*) AS c FROM videos WHERE user_id = :userId AND deleted_at IS NULL AND status = 'published'",
        { userId },
      ),
    ]);

  const profile = await queryOne<{ follower_count: number }>(
    'SELECT follower_count FROM user_profiles WHERE user_id = :userId',
    { userId },
  );

  const watched = Number(watch?.n ?? 0);
  const watchMs = Number(watch?.watch_ms ?? 0);

  return {
    days: window,

    followers: Number(profile?.follower_count ?? 0),
    followerGrowth: Number(growth?.c ?? 0),
    views: Number(totals?.views ?? 0),
    likes: Number(totals?.likes ?? 0),
    comments: Number(totals?.comments ?? 0),
    shares: Number(totals?.shares ?? 0),
    saves: Number(totals?.saves ?? 0),
    profileVisits: Number(visits?.c ?? 0),
    giftCoins: Number(gifts?.c ?? 0),

    watchTimeHours: Math.round((watchMs / 3_600_000) * 10) / 10,
    // Null, not zero: nobody having watched yet is not the same as everyone
    // leaving immediately.
    avgWatchSeconds: watched > 0 ? Math.round((watchMs / watched / 1000) * 10) / 10 : null,
    completionRate:
      watched > 0 ? Math.round((Number(watch?.completions ?? 0) / watched) * 1000) / 10 : null,
    rewatchRate:
      watched > 0 ? Math.round((Number(watch?.rewatches ?? 0) / watched) * 1000) / 10 : null,

    viewsSeries: fillSeries(viewRows, window),
    followerSeries: fillSeries(followRows, window),
    watchMinutesSeries: fillSeries(watchRows, window),

    categories: toPercentages(categoryRows.map((r) => ({ label: r.label, weight: Number(r.weight) }))),
    sources: toPercentages(
      sourceRows.map((r) => ({
        label: SOURCE_LABELS[r.label] ?? r.label,
        weight: Number(r.weight),
      })),
    ),

    topVideos: top.map((v) => ({
      id: v.id,
      caption: v.caption,
      posterUrl: v.poster_key ? storage.url(v.poster_key) : null,
      views: Number(v.views),
      likes: Number(v.likes),
      comments: Number(v.comments),
      watchMinutes: Math.round(Number(v.watch_ms) / 60000),
      publishedAt: v.published_at ? new Date(v.published_at).toISOString() : null,
    })),

    hasNoVideos: Number(videoCount?.c ?? 0) === 0,
  };
}

/**
 * Business analytics.
 *
 * A deliberately smaller set than the creator view: the things a business
 * account can act on. Ad spend is real coins from real campaigns.
 */
export interface BusinessAnalytics {
  days: number;
  profileVisits: number;
  followerGrowth: number;
  views: number;
  adSpendCoins: number;
  campaignsRunning: number;
  reachSeries: SeriesPoint[];
  visitSeries: SeriesPoint[];
  topCategories: { label: string; percent: number }[];
}

export async function businessAnalytics(userId: number, days = 28): Promise<BusinessAnalytics> {
  const window = Math.min(Math.max(days, 1), 90);

  const [visits, growth, views, spend, running, reachRows, visitRows, categoryRows] = await Promise.all([
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM behaviour_events
        WHERE creator_id = :userId AND event = 'profile_visit'
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
      { userId, window },
    ),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM follows
        WHERE followee_id = :userId AND deleted_at IS NULL
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
      { userId, window },
    ),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM watch_events
        WHERE creator_id = :userId
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)`,
      { userId, window },
    ),
    queryOne<{ c: number }>(
      'SELECT COALESCE(SUM(spent_coins),0) AS c FROM campaigns WHERE user_id = :userId',
      { userId },
    ),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM campaigns WHERE user_id = :userId AND status = 'active'",
      { userId },
    ),
    query<{ day: unknown; value: unknown }>(
      `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM watch_events
        WHERE creator_id = :userId
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
        GROUP BY DATE(created_at)`,
      { userId, window },
    ),
    query<{ day: unknown; value: unknown }>(
      `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM behaviour_events
        WHERE creator_id = :userId AND event = 'profile_visit'
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
        GROUP BY DATE(created_at)`,
      { userId, window },
    ),
    query<{ label: string; weight: number }>(
      `SELECT COALESCE(c.name, 'Uncategorised') AS label, COUNT(*) AS weight
         FROM watch_events w
         JOIN videos v ON v.id = w.video_id
         LEFT JOIN categories c ON c.id = v.category_id
        WHERE w.creator_id = :userId
          AND w.created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
        GROUP BY label ORDER BY weight DESC LIMIT 5`,
      { userId, window },
    ),
  ]);

  return {
    days: window,
    profileVisits: Number(visits?.c ?? 0),
    followerGrowth: Number(growth?.c ?? 0),
    views: Number(views?.c ?? 0),
    adSpendCoins: Number(spend?.c ?? 0),
    campaignsRunning: Number(running?.c ?? 0),
    reachSeries: fillSeries(reachRows, window),
    visitSeries: fillSeries(visitRows, window),
    topCategories: toPercentages(categoryRows.map((r) => ({ label: r.label, weight: Number(r.weight) }))),
  };
}
