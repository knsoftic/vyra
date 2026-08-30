/**
 * Watch signal interpretation (ADR-009).
 *
 * A watch is not one number. The same ten seconds means something completely
 * different on a twelve-second clip than on a three-minute one, so the rule
 * scales with length:
 *
 *   under 20s   → completion percentage is the primary signal
 *   20s to 30s  → reaching 20 seconds is a strong positive
 *   over 30s    → reaching 30 seconds is a strong positive
 *
 * Raw duration, completion and rewatch are all retained. None is used alone,
 * because each is gameable on its own: completion favours very short videos,
 * duration favours very long ones, and rewatch can be an accident.
 *
 * The client reports milliseconds and nothing else. It never decides what counts
 * as a view — that judgement lives here, so it can be changed without an app
 * release and cannot be inflated by a modified client.
 */

/** Below this, completion percentage is the signal that matters. */
export const SHORT_VIDEO_MS = 20_000;
/** Above this, thirty seconds is the strong-positive threshold. */
export const LONG_VIDEO_MS = 30_000;

/** A skip this fast is an explicit rejection, not a failure to engage. */
export const QUICK_SKIP_MS = 2_000;

/** Completion at or above this counts as a full watch on a short video. */
export const COMPLETION_THRESHOLD = 0.9;

export interface WatchInput {
  watchMs: number;
  videoMs: number;
  /** Times the video restarted from the beginning. */
  loops?: number;
}

export interface WatchSignal {
  watchMs: number;
  videoMs: number;
  /** 0..1, capped at 1 even when a video loops. */
  completionRate: number;
  reached2s: boolean;
  reached5s: boolean;
  reached10s: boolean;
  reached20s: boolean;
  reached30s: boolean;
  completed: boolean;
  rewatched: boolean;
  quickSkip: boolean;
  /**
   * −1..1. The single number ranking consumes, derived from the rule above.
   * Negative means the watch was itself evidence of disinterest.
   */
  strength: number;
  /** Which branch of the rule applied, so a score can always be explained. */
  rule: 'short_completion' | 'medium_20s' | 'long_30s';
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Interprets one watch.
 *
 * Defensive about its inputs: a client can send anything, and a negative or
 * absurd duration must not produce a NaN strength that then poisons every
 * ranking comparison it touches.
 */
export function interpretWatch(input: WatchInput): WatchSignal {
  const videoMs = Number.isFinite(input.videoMs) && input.videoMs > 0 ? input.videoMs : 0;
  const rawWatch = Number.isFinite(input.watchMs) && input.watchMs > 0 ? input.watchMs : 0;
  const loops = Number.isFinite(input.loops ?? 0) ? Math.max(0, Math.floor(input.loops ?? 0)) : 0;

  // A watch longer than the video means it looped; the excess is rewatching, not
  // a completion rate above 100%.
  const watchMs = videoMs > 0 ? Math.min(rawWatch, videoMs * (loops + 1)) : rawWatch;
  const completionRate = videoMs > 0 ? clamp01(watchMs / videoMs) : 0;

  const reached2s = watchMs >= 2_000;
  const reached5s = watchMs >= 5_000;
  const reached10s = watchMs >= 10_000;
  const reached20s = watchMs >= 20_000;
  const reached30s = watchMs >= 30_000;
  const completed = completionRate >= COMPLETION_THRESHOLD;
  const rewatched = loops > 0 || (videoMs > 0 && rawWatch > videoMs * 1.5);

  // A fast skip is only meaningful if the video was long enough to skip out of.
  const quickSkip = videoMs > QUICK_SKIP_MS && watchMs < QUICK_SKIP_MS;

  let strength: number;
  let rule: WatchSignal['rule'];

  if (videoMs < SHORT_VIDEO_MS) {
    rule = 'short_completion';
    // Completion is the whole story on a short video.
    strength = completionRate;
  } else if (videoMs <= LONG_VIDEO_MS) {
    rule = 'medium_20s';
    // Reaching 20s is the strong positive; below it, scale toward that point.
    strength = reached20s ? 0.85 + completionRate * 0.15 : (watchMs / 20_000) * 0.8;
  } else {
    rule = 'long_30s';
    strength = reached30s ? 0.85 + completionRate * 0.15 : (watchMs / 30_000) * 0.8;
  }

  // Rewatching is a strong positive whatever the length.
  if (rewatched) strength = Math.min(1, strength + 0.15);

  // A quick skip is negative evidence, not merely a weak positive.
  if (quickSkip) strength = -0.5;

  return {
    watchMs,
    videoMs,
    completionRate: Math.round(completionRate * 10000) / 10000,
    reached2s,
    reached5s,
    reached10s,
    reached20s,
    reached30s,
    completed,
    rewatched,
    quickSkip,
    strength: Math.round(clampSigned(strength) * 10000) / 10000,
    rule,
  };
}

const clampSigned = (n: number): number =>
  Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;

/** The threshold events this watch crossed, for the event log. */
export function watchEventsFor(signal: WatchSignal): string[] {
  const events: string[] = [];
  if (signal.reached2s) events.push('watch_2s');
  if (signal.reached5s) events.push('watch_5s');
  if (signal.reached10s) events.push('watch_10s');
  if (signal.reached20s) events.push('watch_20s');
  if (signal.reached30s) events.push('watch_30s');
  if (signal.completed) events.push('completion');
  if (signal.rewatched) events.push('rewatch');
  if (signal.quickSkip) events.push('quick_skip');
  return events;
}

/**
 * Whether a watch counts as a view for the public counter.
 *
 * Deliberately stricter than "the video started": an impression that was
 * scrolled past in half a second is not a view, and counting it would inflate
 * every creator's numbers equally while making them mean nothing.
 */
export function countsAsView(signal: WatchSignal): boolean {
  if (signal.quickSkip) return false;
  if (signal.videoMs < SHORT_VIDEO_MS) return signal.completionRate >= 0.5;
  return signal.reached5s;
}
