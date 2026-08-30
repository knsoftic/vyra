/** Formatting helpers shared across every screen. */

/** 1234 -> "1.2K", 3400000 -> "3.4M" */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const n = value / 1000;
    return `${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)}K`;
  }
  if (value < 1_000_000_000) {
    const n = value / 1_000_000;
    return `${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)}M`;
  }
  return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
}

/** 95 -> "1:35", 3725 -> "1:02:05" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** ISO timestamp -> "3h ago" */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** ISO timestamp -> "14:32" */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO timestamp -> "28 Aug 2026" */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Signed coin amount, e.g. "+1,200" / "-350" */
export function formatCoins(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString()}`;
}

/** Relative time in the short form used on video overlays: "3d", "2w" */
export function shortAge(iso: string): string {
  return timeAgo(iso).replace(' ago', '').replace('just now', 'now');
}

/** "hello world" -> "Hello World" */
export function titleCase(value: string): string {
  return value
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function percent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** Deterministic ISO timestamp N hours in the past — keeps mock data stable per session. */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

export function daysAgo(days: number): string {
  return hoursAgo(days * 24);
}
