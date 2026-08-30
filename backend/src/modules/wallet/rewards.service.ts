/**
 * Daily tasks and referrals.
 *
 * Both hand out reward coins, and both are places where the platform could
 * accidentally pay for nothing. The shape of the defence is the same in each:
 *
 * **Progress is measured, never submitted.** A task's `metric` names something
 * the server already counts — videos posted, minutes watched, people followed.
 * The client cannot report progress, because a client that can report progress
 * can claim any reward it likes.
 *
 * **A reward is claimed once, and the claim is the record.** `user_task_progress`
 * is unique per (user, task, date), and the row moves to `claimed` in the same
 * transaction that credits the coins.
 *
 * **A referral qualifies on an action, not on a signup.** Otherwise the reward
 * is paid for creating accounts, which is a thing people will do at scale with
 * no intention of using them.
 *
 * Everything about the amounts, targets and qualification rule is configuration
 * (ADR-015): the code decides *whether* a reward is due, never *how much*.
 */

import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';
import * as ledger from './ledger.ts';

export interface DailyTask {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  progress: number;
  rewardCoins: number;
  rewardLabel: string;
  state: 'active' | 'completed' | 'claimed' | 'expired';
  claimedAt?: string;
}

/** The day a task belongs to, in the configured reset timezone offset. */
function taskDate(resetHourUtc: number, now = new Date()): string {
  const shifted = new Date(now.getTime() - resetHourUtc * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * How far along the caller is on each metric, counted from their own activity.
 *
 * Each entry is a query the server can answer about itself. Adding a task type
 * means adding a counter here — deliberately, so nobody can define a task whose
 * progress the server has no way to verify.
 */
async function measure(userId: number, date: string): Promise<Record<string, number>> {
  const [videos, likes, comments, follows, watch] = await Promise.all([
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM videos
        WHERE user_id = :userId AND deleted_at IS NULL AND DATE(created_at) = :date`,
      { userId, date },
    ),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM likes
        WHERE user_id = :userId AND deleted_at IS NULL AND DATE(created_at) = :date`,
      { userId, date },
    ).catch(() => ({ c: 0 })),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM comments
        WHERE user_id = :userId AND deleted_at IS NULL AND DATE(created_at) = :date`,
      { userId, date },
    ).catch(() => ({ c: 0 })),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM follows
        WHERE follower_id = :userId AND deleted_at IS NULL AND DATE(created_at) = :date`,
      { userId, date },
    ),
    queryOne<{ c: number }>(
      `SELECT COALESCE(SUM(watch_ms), 0) DIV 60000 AS c FROM watch_events
        WHERE user_id = :userId AND DATE(created_at) = :date`,
      { userId, date },
    ).catch(() => ({ c: 0 })),
  ]);

  return {
    videos_posted: Number(videos?.c ?? 0),
    likes_given: Number(likes?.c ?? 0),
    comments_posted: Number(comments?.c ?? 0),
    follows_made: Number(follows?.c ?? 0),
    watch_minutes: Number(watch?.c ?? 0),
  };
}

/**
 * Today's tasks with the caller's progress.
 *
 * Progress rows are created lazily on first read, so a user who never opens the
 * screen costs nothing, and the reward stored on the row is the one that was
 * advertised when they started — changing a task's reward mid-day does not
 * reduce what someone was already working towards.
 */
export async function listTasks(userId: number): Promise<DailyTask[]> {
  const resetHour = Number(await getSetting('tasks.reset_hour_utc')) || 0;
  const date = taskDate(resetHour);

  const tasks = await query<{
    id: number;
    task_key: string;
    title: string;
    description: string | null;
    icon: string | null;
    metric: string;
    target: string | number;
    reward_coins: string | number;
    reward_label: string | null;
  }>(
    `SELECT id, task_key, title, description, icon, metric, target, reward_coins, reward_label
       FROM daily_tasks
      WHERE is_enabled = 1
      ORDER BY sort_order, id`,
  );
  if (tasks.length === 0) return [];

  const measured = await measure(userId, date);

  const existing = await query<{
    task_id: number;
    progress: string | number;
    target: string | number;
    state: DailyTask['state'];
    reward_coins: string | number;
    claimed_at: Date | null;
  }>(
    `SELECT task_id, progress, target, state, reward_coins, claimed_at
       FROM user_task_progress
      WHERE user_id = :userId AND task_date = :date`,
    { userId, date },
  );
  const byTask = new Map(existing.map((row) => [row.task_id, row]));

  const result: DailyTask[] = [];

  for (const task of tasks) {
    const progress = measured[task.metric] ?? 0;
    const row = byTask.get(task.id);

    // The target and reward are frozen onto the row the first time it is seen.
    const target = row ? Number(row.target) : Number(task.target);
    const rewardCoins = row ? Number(row.reward_coins) : Number(task.reward_coins);

    let state: DailyTask['state'] =
      row?.state === 'claimed' ? 'claimed' : progress >= target ? 'completed' : 'active';

    if (!row) {
      await execute(
        `INSERT INTO user_task_progress
           (user_id, task_id, task_date, progress, target, state, reward_coins)
         VALUES (:userId, :taskId, :date, :progress, :target, :state, :reward)
         ON DUPLICATE KEY UPDATE progress = :progress, state = :state`,
        { userId, taskId: task.id, date, progress, target, state, reward: rewardCoins },
      );
    } else if (row.state !== 'claimed') {
      await execute(
        `UPDATE user_task_progress SET progress = :progress, state = :state
          WHERE user_id = :userId AND task_id = :taskId AND task_date = :date`,
        { progress, state, userId, taskId: task.id, date },
      );
    } else {
      state = 'claimed';
    }

    const entry: DailyTask = {
      id: String(task.id),
      key: task.task_key,
      title: task.title,
      description: task.description ?? '',
      icon: task.icon ?? 'checkmark-circle-outline',
      target,
      progress: Math.min(progress, target),
      rewardCoins,
      rewardLabel: task.reward_label ?? 'coins',
      state,
    };
    if (row?.claimed_at) entry.claimedAt = new Date(row.claimed_at).toISOString();
    result.push(entry);
  }

  return result;
}

export interface ClaimResult {
  taskId: string;
  rewardCoins: number;
  rewardBalance: number;
  alreadyClaimed: boolean;
}

/**
 * Claims a completed task.
 *
 * The reward goes to the `reward` wallet, not `coin` — reward coins are
 * spendable in-app and convertible to coins at a configurable rate, but they
 * are never withdrawable. That is what stops a task farm becoming a payroll.
 */
export async function claimTask(userId: number, taskId: string): Promise<ClaimResult> {
  const resetHour = Number(await getSetting('tasks.reset_hour_utc')) || 0;
  const date = taskDate(resetHour);

  const row = await queryOne<{
    id: number;
    progress: string | number;
    target: string | number;
    state: string;
    reward_coins: string | number;
  }>(
    `SELECT p.id, p.progress, p.target, p.state, p.reward_coins
       FROM user_task_progress p
      WHERE p.user_id = :userId AND p.task_id = :taskId AND p.task_date = :date`,
    { userId, taskId: Number(taskId), date },
  );

  if (!row) {
    throw new AppError('not_found', 'That task has not been started today.');
  }
  if (row.state === 'claimed') {
    const balances = await ledger.getBalances(userId);
    return {
      taskId,
      rewardCoins: Number(row.reward_coins),
      rewardBalance: balances.reward,
      alreadyClaimed: true,
    };
  }
  if (Number(row.progress) < Number(row.target)) {
    throw new AppError('bad_request', 'That task is not finished yet.');
  }

  const reward = Number(row.reward_coins);

  await transaction(async (tx) => {
    // Claim the row first: a second request matches nothing and credits nothing.
    const claimed = await execute(
      `UPDATE user_task_progress
          SET state = 'claimed', claimed_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id AND state <> 'claimed'`,
      { id: row.id },
      tx,
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That reward has already been claimed.');
    }

    const credited = await ledger.credit(tx, {
      userId,
      wallet: 'reward',
      type: 'task_reward',
      amount: reward,
      description: 'Daily task reward',
      reference: `task:${taskId}:${date}`,
      idempotencyKey: `task:${userId}:${taskId}:${date}`,
    });

    await execute(
      'UPDATE user_task_progress SET ledger_id = :ledgerId WHERE id = :id',
      { ledgerId: credited.ledgerId, id: row.id },
      tx,
    );
  });

  const balances = await ledger.getBalances(userId);
  return { taskId, rewardCoins: reward, rewardBalance: balances.reward, alreadyClaimed: false };
}

/**
 * Turns reward coins into spendable coins.
 *
 * The rate is configuration. `convert` refuses any pair not on the allow-list,
 * which is what keeps this one-way: coins never become reward balance, and
 * neither ever becomes withdrawable.
 */
export async function convertReward(
  userId: number,
  amount: number,
  idempotencyKey: string,
): Promise<{ converted: number; coins: number; rewardBalance: number; coinBalance: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('bad_request', 'Enter an amount to convert.');
  }

  const rate = Number(await getSetting('monetization.reward_to_coin_rate')) || 1;

  const result = await transaction(async (tx) =>
    ledger.convert(tx, {
      userId,
      from: 'reward',
      to: 'coin',
      amount,
      rate,
      type: 'reward_to_coins',
      description: 'Reward balance converted to coins',
      idempotencyKey: `convert:${idempotencyKey}`,
    }),
  );

  const balances = await ledger.getBalances(userId);
  return {
    converted: amount,
    coins: result.produced,
    rewardBalance: balances.reward,
    coinBalance: balances.coin,
  };
}

// ── Referrals ──

export interface ReferralSummary {
  code: string;
  rewardCoins: number;
  qualificationRule: string;
  invited: number;
  qualified: number;
  earned: number;
  recent: {
    username: string;
    qualified: boolean;
    rewardCoins: number;
    createdAt: string;
  }[];
}

/** The caller's code, created on first use so every account has one. */
export async function referralCode(userId: number): Promise<string> {
  const existing = await queryOne<{ code: string }>(
    'SELECT code FROM referral_codes WHERE user_id = :userId',
    { userId },
  );
  if (existing) return existing.code;

  const user = await queryOne<{ username: string }>('SELECT username FROM users WHERE id = :id', {
    id: userId,
  });

  // Derived from the username so it is recognisable, with a suffix so it is
  // unique even when two usernames normalise to the same thing.
  const base = (user?.username ?? 'vyra').replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `${base}${suffix}`.slice(0, 20);
    try {
      await execute('INSERT INTO referral_codes (user_id, code) VALUES (:userId, :code)', {
        userId,
        code,
      });
      return code;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // A collision on the code; another suffix will do. A collision on the
      // user means a concurrent request already made one.
      const now = await queryOne<{ code: string }>(
        'SELECT code FROM referral_codes WHERE user_id = :userId',
        { userId },
      );
      if (now) return now.code;
    }
  }
  throw new AppError('internal_error', 'Could not allocate a referral code.');
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

export async function referralSummary(userId: number): Promise<ReferralSummary> {
  const [code, rewardCoins, rule] = await Promise.all([
    referralCode(userId),
    getSetting('referral.reward_coins'),
    getSetting('referral.qualification_rule'),
  ]);

  const rows = await query<{
    username: string;
    qualified_at: Date | null;
    reward_coins: string | number;
    created_at: Date;
    reversed_at: Date | null;
  }>(
    `SELECT u.username, r.qualified_at, r.reward_coins, r.created_at, r.reversed_at
       FROM referrals r
       JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = :userId
      ORDER BY r.created_at DESC
      LIMIT 50`,
    { userId },
  );

  const qualified = rows.filter((r) => r.qualified_at !== null && r.reversed_at === null);

  return {
    code,
    rewardCoins: Number(rewardCoins),
    qualificationRule: String(rule),
    invited: rows.length,
    qualified: qualified.length,
    earned: qualified.reduce((sum, r) => sum + Number(r.reward_coins), 0),
    recent: rows.map((r) => ({
      username: r.username,
      qualified: r.qualified_at !== null && r.reversed_at === null,
      rewardCoins: Number(r.reward_coins),
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

/**
 * Records that someone signed up with a code.
 *
 * No reward yet — that waits for qualification. The signup IP and device are
 * stored because self-referral rings are the obvious abuse and they leave a
 * pattern here.
 */
export async function recordReferral(
  referredId: number,
  code: string,
  context: { ip?: string; device?: string },
): Promise<{ recorded: boolean }> {
  const owner = await queryOne<{ user_id: number }>(
    'SELECT user_id FROM referral_codes WHERE code = :code',
    { code: code.toUpperCase() },
  );
  if (!owner) return { recorded: false };
  if (owner.user_id === referredId) return { recorded: false };

  const rewardCoins = Number(await getSetting('referral.reward_coins'));

  try {
    await execute(
      `INSERT INTO referrals (referrer_id, referred_id, code, reward_coins, signup_ip, signup_device)
       VALUES (:referrer, :referred, :code, :reward, INET6_ATON(:ip), :device)`,
      {
        referrer: owner.user_id,
        referred: referredId,
        code: code.toUpperCase(),
        reward: rewardCoins,
        ip: context.ip ?? '::',
        device: context.device ?? null,
      },
    );
  } catch (err) {
    // One referral per referred account, whoever gets there first.
    if (isDuplicateKey(err)) return { recorded: false };
    throw err;
  }

  return { recorded: true };
}

/**
 * Pays a referral once the referred account does something real.
 *
 * Called from wherever the qualifying action happens — currently publishing a
 * first video. Idempotent on `qualified_at`, so being called twice pays once.
 */
export async function qualifyReferral(referredId: number): Promise<{ paid: boolean }> {
  const row = await queryOne<{
    id: number;
    referrer_id: number;
    reward_coins: string | number;
    qualified_at: Date | null;
  }>(
    `SELECT id, referrer_id, reward_coins, qualified_at
       FROM referrals
      WHERE referred_id = :referredId AND reversed_at IS NULL`,
    { referredId },
  );
  if (!row || row.qualified_at !== null) return { paid: false };

  const reward = Number(row.reward_coins);
  if (reward <= 0) return { paid: false };

  try {
    await transaction(async (tx) => {
      const claimed = await execute(
        `UPDATE referrals SET qualified_at = CURRENT_TIMESTAMP(3)
          WHERE id = :id AND qualified_at IS NULL`,
        { id: row.id },
        tx,
      );
      if (claimed.affectedRows === 0) return;

      const credited = await ledger.credit(tx, {
        userId: row.referrer_id,
        wallet: 'reward',
        type: 'referral_reward',
        amount: reward,
        description: 'Referral reward',
        relatedUserId: referredId,
        idempotencyKey: `referral:${row.id}`,
      });

      await execute('UPDATE referrals SET ledger_id = :ledgerId WHERE id = :id', {
        ledgerId: credited.ledgerId,
        id: row.id,
      }, tx);
    });
  } catch (err) {
    logger.error({ err, referredId }, 'referral qualification failed');
    return { paid: false };
  }

  return { paid: true };
}
