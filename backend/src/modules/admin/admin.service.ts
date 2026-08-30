/**
 * The admin panel's read model, and its memory.
 *
 * Everything here is a straight look at tables other modules own. That is
 * deliberate: the admin panel observes and decides, it does not get its own
 * copy of the truth to drift out of date.
 *
 * The audit trail every admin mutation writes lives in `middleware/audit.ts`;
 * this file only reads it back for the audit screen.
 */

import { query, queryOne } from '../../core/db.ts';

// ── Audit reads (writes go through middleware/audit.ts, which also captures IP and user agent) ──

export async function auditLog(limit = 100): Promise<unknown[]> {
  return query(
    `SELECT id, admin_name AS adminName, role_slug AS roleSlug, module, action,
            target_type AS targetType, target_id AS targetId,
            old_value AS oldValue, new_value AS newValue, reason, created_at AS createdAt
       FROM audit_logs ORDER BY id DESC LIMIT :limit`,
    { limit },
  );
}

// ── Dashboard ──

async function count(sql: string): Promise<number> {
  const row = await queryOne<{ c: number }>(sql).catch(() => ({ c: 0 }));
  return Number(row?.c ?? 0);
}

export async function dashboard(): Promise<Record<string, unknown>> {
  const [
    users, activeToday, signupsWeek, videos, videosToday, liveNow,
    openReports, pendingVerification, pendingPurchases, pendingWithdrawals,
    openTickets, pendingCampaigns, coinsSoldWeek, giftCoinsWeek,
  ] = await Promise.all([
    count('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL'),
    count('SELECT COUNT(*) AS c FROM users WHERE last_active_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND deleted_at IS NULL'),
    count('SELECT COUNT(*) AS c FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL'),
    count("SELECT COUNT(*) AS c FROM videos WHERE deleted_at IS NULL AND status = 'published'"),
    count("SELECT COUNT(*) AS c FROM videos WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND deleted_at IS NULL"),
    count("SELECT COUNT(*) AS c FROM live_streams WHERE status = 'live'"),
    count("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    count("SELECT COUNT(*) AS c FROM verification_requests WHERE status IN ('pending','reviewing')"),
    count("SELECT COUNT(*) AS c FROM coin_purchase_requests WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS c FROM withdrawal_requests WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('open','in_progress')"),
    count("SELECT COUNT(*) AS c FROM campaigns WHERE status = 'pending_review'"),
    count("SELECT COALESCE(SUM(coins),0) AS c FROM coin_purchase_requests WHERE status = 'approved' AND decided_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
    count('SELECT COALESCE(SUM(coins_spent),0) AS c FROM gift_transactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
  ]);

  return {
    users, activeToday, signupsWeek, videos, videosToday, liveNow,
    queues: {
      reports: openReports,
      verification: pendingVerification,
      coinRequests: pendingPurchases,
      withdrawals: pendingWithdrawals,
      support: openTickets,
      campaigns: pendingCampaigns,
    },
    money: { coinsSoldWeek, giftCoinsWeek },
  };
}

// ── Analytics ──

/**
 * `YYYY-MM-DD` in local time, for either a Date or a string.
 *
 * mysql2 returns a `DATE(...)` column as a JS Date, and `String(date)` starts
 * with "Sat Aug 29" — which matched nothing, so every chart drew zero for every
 * day while the totals above it were correct. Both sides of the join go through
 * this one formatter, in local time, because `toISOString()` is UTC and would
 * shift the bucket near midnight on any host east of Greenwich.
 */
function dayKey(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Day-bucketed counts for the last `days` days, oldest first, gaps filled. */
async function series(sql: string, days: number): Promise<{ day: string; value: number }[]> {
  const rows = await query<{ day: unknown; value: number }>(sql, { days }).catch(() => []);
  const byDay = new Map(rows.map((r) => [dayKey(r.day), Number(r.value)]));
  const out: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = dayKey(new Date(Date.now() - i * 86_400_000));
    out.push({ day: d, value: byDay.get(d) ?? 0 });
  }
  return out;
}

export async function analytics(days = 14): Promise<Record<string, unknown>> {
  const [signups, videos, watchMinutes, giftCoins] = await Promise.all([
    series(
      `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM users
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY) AND deleted_at IS NULL
        GROUP BY DATE(created_at)`,
      days,
    ),
    series(
      `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM videos
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY) AND deleted_at IS NULL
        GROUP BY DATE(created_at)`,
      days,
    ),
    series(
      `SELECT DATE(created_at) AS day, COALESCE(ROUND(SUM(watch_ms)/60000),0) AS value FROM watch_events
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY)
        GROUP BY DATE(created_at)`,
      days,
    ),
    series(
      `SELECT DATE(created_at) AS day, COALESCE(SUM(coins_spent),0) AS value FROM gift_transactions
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY)
        GROUP BY DATE(created_at)`,
      days,
    ),
  ]);

  return { signups, videos, watchMinutes, giftCoins };
}
