/**
 * Migration safety validator.
 *
 * This is the enforcement point for the project's permanent data-protection rule:
 * updates must NEVER delete or reset existing user data. Every migration is parsed
 * before it can run, and anything that could destroy user data is refused.
 *
 * It is deliberately conservative. A false positive costs a developer two minutes;
 * a false negative costs users their videos, messages or wallet balances.
 */

/** Tables that hold user-owned data. Destructive DDL here is always refused. */
export const USER_DATA_TABLES = new Set([
  'users', 'user_profiles', 'business_profiles', 'user_devices', 'user_sessions',
  'follows', 'blocks',
  'videos', 'video_drafts', 'video_metadata', 'video_assets', 'video_hashtags',
  'sounds', 'music_tracks',
  'video_views', 'watch_events', 'impressions', 'likes', 'comments', 'comment_likes',
  'shares', 'saves', 'negative_signals',
  'chats', 'chat_participants', 'messages', 'message_receipts',
  'groups', 'group_members', 'communities', 'community_members', 'community_join_requests',
  'calls', 'call_participants', 'live_streams', 'live_viewers', 'live_comments', 'live_gifts',
  'wallets', 'wallet_ledger', 'coin_purchase_requests', 'withdrawal_requests', 'payments',
  'gift_transactions', 'user_task_progress', 'referrals',
  'promotions', 'campaigns', 'campaign_analytics',
  'verification_requests', 'verification_documents', 'reports', 'moderation_actions',
  'support_tickets', 'ticket_messages', 'notifications',
  'audit_logs',
]);

export interface Violation {
  rule: string;
  detail: string;
  statement: string;
}

/**
 * Strip comments and string literals so keywords inside them do not trip the
 * rules — and, far more importantly, so that a comment character *inside* a
 * string cannot hide a statement from the rules.
 *
 * This was a sequence of independent regexes, which is not something you can do
 * to SQL: applying them in order means a `#` inside a string literal is treated
 * as a comment and eats the rest of the line, semicolon included. A colour like
 * `'#7C5CFF'` merged its statement with the next one. The same flaw let a
 * destructive statement escape review entirely:
 *
 *     INSERT INTO t VALUES ('#x'); DROP TABLE users;
 *
 * The `#` opened a "comment" that swallowed the DROP before any rule saw it.
 *
 * So this is a single left-to-right scan that tracks whether it is inside a
 * string, an identifier or a comment, and only then decides what a character
 * means. Backtick identifiers are preserved because the rules match on them;
 * string contents are blanked; comments become whitespace.
 */
function normalize(sql: string): string {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];

    // Block comment.
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }

    // Line comment. MySQL requires whitespace after `--`, so `a--b` is
    // arithmetic, not a comment — matching that keeps statements visible rather
    // than silently discarded.
    const isDashComment =
      c === '-' && next === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]!));
    if (isDashComment || c === '#') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }

    // String literal. Both `\'` and `''` escape a quote inside one.
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < sql.length) {
        const ch = sql[i]!;
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += quote + quote;
      continue;
    }

    // Backtick identifier — kept verbatim; the rules match table names on it.
    if (c === '`') {
      const end = sql.indexOf('`', i + 1);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/** Split on semicolons that terminate a statement. */
export function splitStatements(sql: string): string[] {
  return normalize(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ident = '`?([a-zA-Z0-9_]+)`?';

/**
 * Rules a migration has waived in writing.
 *
 * A waiver line looks like:
 *
 *     -- migration-waiver: review-type-narrowing — <why this one is safe>
 *
 * Only rules in `WAIVABLE_RULES` can be waived, and a waiver needs a reason —
 * a bare rule name is ignored, because the reason is the whole point. Recording
 * it in the migration means the justification lives beside the statement
 * forever and shows up in review, rather than being a `--allow-narrowing` flag
 * somebody typed once at a terminal and nobody can see afterwards.
 *
 * It also means the operator running `npm run migrate:up` on a server is not
 * stopped by a decision that was already taken and reasoned about here.
 */
export function waivedRules(sql: string): Set<string> {
  const waived = new Set<string>();
  const pattern = /^\s*--\s*migration-waiver:\s*([\w-]+)\s*[—:-]\s*(.+)$/gim;

  for (const match of sql.matchAll(pattern)) {
    const rule = match[1] ?? '';
    const reason = (match[2] ?? '').trim();
    if (WAIVABLE_RULES.has(rule) && reason.length >= 20) waived.add(rule);
  }
  return waived;
}

export function validateMigration(sql: string): Violation[] {
  const violations: Violation[] = [];
  const statements = splitStatements(sql);
  const waived = waivedRules(sql);

  for (const raw of statements) {
    const statement = raw.replace(/\s+/g, ' ').trim();
    const upper = statement.toUpperCase();

    // ── Absolute refusals ──

    const dropTable = statement.match(new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${ident}`, 'i'));
    if (dropTable) {
      violations.push({
        rule: 'no-drop-table',
        detail: `DROP TABLE is never allowed. Deprecate '${dropTable[1]}' instead and stop writing to it.`,
        statement,
      });
    }

    const truncate = statement.match(new RegExp(`^TRUNCATE\\s+(?:TABLE\\s+)?${ident}`, 'i'));
    if (truncate) {
      violations.push({
        rule: 'no-truncate',
        detail: `TRUNCATE destroys every row in '${truncate[1]}'. Never allowed in a migration.`,
        statement,
      });
    }

    if (/^DROP\s+DATABASE/i.test(statement)) {
      violations.push({
        rule: 'no-drop-database',
        detail: 'DROP DATABASE is never allowed under any circumstances.',
        statement,
      });
    }

    // DELETE without WHERE wipes the table.
    if (/^DELETE\s+FROM/i.test(statement) && !/\sWHERE\s/i.test(upper)) {
      violations.push({
        rule: 'no-unbounded-delete',
        detail: 'DELETE without a WHERE clause removes every row. Add a WHERE clause.',
        statement,
      });
    }

    // UPDATE without WHERE rewrites the table — including balances.
    if (/^UPDATE\s/i.test(statement) && !/\sWHERE\s/i.test(upper)) {
      violations.push({
        rule: 'no-unbounded-update',
        detail: 'UPDATE without a WHERE clause rewrites every row. Add a WHERE clause.',
        statement,
      });
    }

    // ── ALTER TABLE rules ──

    const alter = statement.match(new RegExp(`^ALTER\\s+TABLE\\s+${ident}\\s+([\\s\\S]+)$`, 'i'));
    if (alter) {
      const table = alter[1] ?? '';
      const body = alter[2] ?? '';
      const isUserTable = USER_DATA_TABLES.has(table.toLowerCase());

      const dropColumn = body.match(new RegExp(`DROP\\s+(?:COLUMN\\s+)?${ident}`, 'i'));
      if (dropColumn && !/DROP\s+(INDEX|KEY|FOREIGN|PRIMARY|CONSTRAINT|CHECK)/i.test(body)) {
        if (isUserTable) {
          violations.push({
            rule: 'no-drop-column-on-user-table',
            detail: `Dropping column '${dropColumn[1] ?? ''}' from user table '${table}' destroys user data. Deprecate the column instead: stop writing to it and record it in DATABASE_MIGRATION_LOG.md.`,
            statement,
          });
        }
      }

      // NOT NULL without a default on an existing table fails or silently coerces data.
      if (/ADD\s+(?:COLUMN\s+)?/i.test(body) && /NOT\s+NULL/i.test(body) && !/DEFAULT/i.test(body)) {
        const isAutoIncrement = /AUTO_INCREMENT/i.test(body);
        if (!isAutoIncrement) {
          violations.push({
            rule: 'not-null-without-default',
            detail: `Adding a NOT NULL column to '${table}' without a DEFAULT fails on a populated table. Make it nullable, or give it a default.`,
            statement,
          });
        }
      }

      // Renaming loses the old column in one step — the safe path is add → backfill → switch.
      if (/RENAME\s+COLUMN/i.test(body) && isUserTable) {
        violations.push({
          rule: 'no-rename-on-user-table',
          detail: `Renaming a column on user table '${table}' breaks running code mid-deploy. Use add new → dual-write → backfill → switch reads → deprecate old.`,
          statement,
        });
      }

      // MODIFY that narrows a type can silently truncate values.
      const narrowing = body.match(/(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?`?\w+`?\s+(VARCHAR\s*\(\d+\)|CHAR\s*\(\d+\)|TINYINT|SMALLINT|MEDIUMINT|INT)(?!\w)/i);
      if (narrowing && isUserTable) {
        violations.push({
          rule: 'review-type-narrowing',
          detail: `Changing a column type on user table '${table}' to ${narrowing[1] ?? 'a narrower type'} can truncate existing values. Verify the widest existing value first, then override with --allow-narrowing if it is genuinely safe.`,
          statement,
        });
      }
    }
  }

  // A rule the migration waived in writing, with a reason, is not reported.
  return violations.filter((v) => !waived.has(v.rule));
}

/** Rules that a reviewer can consciously waive, given evidence. */
export const WAIVABLE_RULES = new Set(['review-type-narrowing']);
