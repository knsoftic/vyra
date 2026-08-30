/**
 * Event payload privacy (ADR-008).
 *
 * Exit criterion 5 of PHASE_06 is "event payloads audited — no sensitive fields
 * present". An audit is a point-in-time check; this is the mechanism that makes
 * the property hold continuously.
 *
 * Two layers, and they do different jobs:
 *
 *   **The allowlist** is what actually protects the data. Only fields named in
 *   `EVENT_FIELDS` are copied into the row that gets stored, so an unknown field
 *   is dropped whether or not anyone anticipated it.
 *
 *   **The denylist** exists to make a problem visible. A payload carrying
 *   `email` or `latitude` would already have been stripped, but silently
 *   dropping it hides a client that is trying to send it. Rejecting the event
 *   loudly means someone finds out.
 */

import {
  EVENT_FIELDS,
  FORBIDDEN_EVENT_FIELDS,
  type EventField,
} from '../../../../shared/contracts/behaviour.ts';

const ALLOWED = new Set<string>(EVENT_FIELDS);
const FORBIDDEN = new Set<string>(FORBIDDEN_EVENT_FIELDS.map((f) => f.toLowerCase()));

export interface PrivacyVerdict {
  ok: boolean;
  /** Fields dropped because they are not on the allowlist. */
  dropped: string[];
  /** Fields that must never be sent. Their presence rejects the event. */
  forbidden: string[];
}

/**
 * Checks one payload without modifying it.
 *
 * Matching is case-insensitive and ignores separators, so `user_email`,
 * `userEmail` and `USER-EMAIL` are all caught by the single entry `email`.
 */
export function inspectPayload(payload: Record<string, unknown>): PrivacyVerdict {
  const dropped: string[] = [];
  const forbidden: string[] = [];

  for (const key of Object.keys(payload)) {
    const normalised = key.toLowerCase().replace(/[_\-\s]/g, '');

    const isForbidden = [...FORBIDDEN].some(
      (bad) => normalised === bad || normalised.endsWith(bad) || normalised.startsWith(bad),
    );
    if (isForbidden) {
      forbidden.push(key);
      continue;
    }
    if (!ALLOWED.has(key)) dropped.push(key);
  }

  return { ok: forbidden.length === 0, dropped, forbidden };
}

/**
 * Returns a copy containing only allowlisted fields.
 *
 * Everything the server persists goes through here. `undefined` values are
 * skipped so an explicitly-absent field is not stored as null noise.
 */
export function sanitisePayload(
  payload: Record<string, unknown>,
): Partial<Record<EventField, unknown>> {
  const clean: Partial<Record<EventField, unknown>> = {};
  for (const field of EVENT_FIELDS) {
    const value = payload[field];
    if (value !== undefined && value !== null) clean[field] = value;
  }
  return clean;
}

/**
 * Free-text carried on an event, currently only a search query.
 *
 * Truncated and stripped of anything that looks like contact information. A
 * search box is a place people occasionally paste an email address or a phone
 * number, and that should not become a stored behavioural signal.
 */
export function sanitiseQuery(query: string): string {
  return query
    .slice(0, 120)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[removed]')
    .trim();
}

/**
 * Audits stored rows for anything sensitive that slipped through.
 *
 * Defence in depth: the allowlist should make this impossible, so a non-empty
 * result means the allowlist itself has a hole worth investigating.
 */
export function auditStoredDetail(detail: unknown): PrivacyVerdict {
  if (detail === null || detail === undefined) {
    return { ok: true, dropped: [], forbidden: [] };
  }
  let parsed: unknown = detail;
  if (typeof detail === 'string') {
    try {
      parsed = JSON.parse(detail);
    } catch {
      return { ok: true, dropped: [], forbidden: [] };
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: true, dropped: [], forbidden: [] };
  }
  return inspectPayload(parsed as Record<string, unknown>);
}
