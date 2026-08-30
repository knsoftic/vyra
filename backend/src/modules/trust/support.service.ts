/**
 * Support tickets.
 *
 * The dangerous thing here is `ticket_messages.is_internal`. Staff write notes
 * to each other on a ticket — "this account has three chargebacks", "probably a
 * refund scam" — and those notes sit in the same table as the replies the user
 * reads.
 *
 * So the filter is applied in the query, not in the mapping and not in the
 * client. A user-facing read never selects an internal row at all, which means
 * a bug in a later mapper cannot leak one. There is exactly one function that
 * returns internal notes and it takes a staff caller.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';

export type TicketCategory =
  | 'account'
  | 'payment'
  | 'coins'
  | 'video'
  | 'verification'
  | 'advertisement'
  | 'technical';

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';

export interface TicketMessage {
  id: string;
  body: string;
  isStaff: boolean;
  /** Only ever true on a staff read. A user read cannot produce one. */
  isInternal?: boolean;
  authorName: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  subject: string;
  category: TicketCategory;
  priority: 'low' | 'medium' | 'high';
  status: TicketStatus;
  messages: TicketMessage[];
  createdAt: string;
  updatedAt: string;
}

interface TicketRow {
  id: number;
  public_id: string;
  subject: string;
  category: TicketCategory;
  priority: Ticket['priority'];
  status: TicketStatus;
  created_at: Date;
  updated_at: Date;
}

function toTicket(row: TicketRow, messages: TicketMessage[]): Ticket {
  return {
    id: row.public_id,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    messages,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Reads the conversation on a ticket.
 *
 * `includeInternal` is false by default and the caller must pass true
 * deliberately. The exclusion is in the WHERE clause: a user-facing read never
 * fetches an internal row, so no later mistake can expose one.
 */
async function messagesFor(
  ticketId: number,
  includeInternal: boolean,
): Promise<TicketMessage[]> {
  const rows = await query<{
    id: number;
    body: string;
    is_staff: number;
    is_internal: number;
    created_at: Date;
    author_name: string | null;
  }>(
    `SELECT m.id, m.body, m.is_staff, m.is_internal, m.created_at,
            p.display_name AS author_name
       FROM ticket_messages m
       LEFT JOIN user_profiles p ON p.user_id = m.author_id
      WHERE m.ticket_id = :ticketId
        AND m.deleted_at IS NULL
        ${includeInternal ? '' : 'AND m.is_internal = 0'}
      ORDER BY m.created_at`,
    { ticketId },
  );

  return rows.map((row) => {
    const message: TicketMessage = {
      id: String(row.id),
      body: row.body,
      isStaff: row.is_staff === 1,
      // Staff replies are shown as coming from support rather than from a named
      // person: a support agent's name is not something a frustrated user needs.
      authorName: row.is_staff === 1 ? 'Support' : (row.author_name ?? 'You'),
      createdAt: new Date(row.created_at).toISOString(),
    };
    if (includeInternal && row.is_internal === 1) message.isInternal = true;
    return message;
  });
}

const TICKET_SELECT = `
  SELECT id, public_id, subject, category, priority, status, created_at, updated_at
    FROM support_tickets
   WHERE deleted_at IS NULL
`;

export async function createTicket(
  userId: number,
  input: { subject: string; category: TicketCategory; body: string },
): Promise<Ticket> {
  // A support queue nobody can work is worse than a slow one, so an account
  // cannot stack up open tickets faster than they can be answered.
  const open = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM support_tickets
      WHERE user_id = :userId AND deleted_at IS NULL
        AND status IN ('open', 'in_progress', 'waiting')`,
    { userId },
  );
  if (Number(open?.c ?? 0) >= 5) {
    throw new AppError(
      'rate_limited',
      'You already have five open tickets. Please continue on one of those.',
    );
  }

  const publicId = ulid();

  await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO support_tickets (public_id, user_id, subject, category, priority, status)
       VALUES (:publicId, :userId, :subject, :category, 'medium', 'open')`,
      { publicId, userId, subject: input.subject, category: input.category },
      tx,
    );

    await execute(
      `INSERT INTO ticket_messages (ticket_id, author_id, is_staff, is_internal, body)
       VALUES (:ticketId, :userId, 0, 0, :body)`,
      { ticketId: result.insertId, userId, body: input.body },
      tx,
    );
  });

  logger.info({ publicId, userId, category: input.category }, 'support ticket opened');
  return getTicket(userId, publicId);
}

export async function listTickets(userId: number, limit = 50): Promise<Ticket[]> {
  const rows = await query<TicketRow>(
    `${TICKET_SELECT} AND user_id = :userId ORDER BY updated_at DESC LIMIT :limit`,
    { userId, limit },
  );
  // The list does not carry conversations; opening a ticket fetches its own.
  return rows.map((row) => toTicket(row, []));
}

export async function getTicket(userId: number, publicId: string): Promise<Ticket> {
  const row = await queryOne<TicketRow>(
    `${TICKET_SELECT} AND public_id = :publicId AND user_id = :userId`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Ticket not found.');
  // Never internal, because this is the user's own read.
  return toTicket(row, await messagesFor(row.id, false));
}

export async function reply(
  userId: number,
  publicId: string,
  body: string,
): Promise<Ticket> {
  const row = await queryOne<TicketRow>(
    `${TICKET_SELECT} AND public_id = :publicId AND user_id = :userId`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Ticket not found.');
  if (row.status === 'closed') {
    throw new AppError('invalid_state_transition', 'That ticket is closed. Please open a new one.');
  }

  await transaction(async (tx) => {
    await execute(
      `INSERT INTO ticket_messages (ticket_id, author_id, is_staff, is_internal, body)
       VALUES (:ticketId, :userId, 0, 0, :body)`,
      { ticketId: row.id, userId, body },
      tx,
    );
    // A reply from the user reopens a waiting ticket, so an answered question
    // does not sit closed while they are still asking.
    await execute(
      `UPDATE support_tickets
          SET status = CASE WHEN status IN ('waiting', 'resolved') THEN 'open' ELSE status END,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id`,
      { id: row.id },
      tx,
    );
  });

  return getTicket(userId, publicId);
}

export async function closeTicket(userId: number, publicId: string): Promise<Ticket> {
  const row = await queryOne<TicketRow>(
    `${TICKET_SELECT} AND public_id = :publicId AND user_id = :userId`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Ticket not found.');

  await execute(
    "UPDATE support_tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP(3) WHERE id = :id",
    { id: row.id },
  );
  return getTicket(userId, publicId);
}

// ── Staff ──

export interface StaffTicket extends Ticket {
  username: string;
  assignee?: string;
}

export async function staffQueue(
  options: { status?: TicketStatus; category?: TicketCategory; limit?: number } = {},
): Promise<StaffTicket[]> {
  const rows = await query<TicketRow & { username: string; assignee: string | null }>(
    `SELECT t.id, t.public_id, t.subject, t.category, t.priority, t.status,
            t.created_at, t.updated_at, u.username,
            a.name AS assignee
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN admin_users a ON a.id = t.assignee_id
      WHERE t.deleted_at IS NULL
        ${options.status ? 'AND t.status = :status' : "AND t.status <> 'closed'"}
        ${options.category ? 'AND t.category = :category' : ''}
      ORDER BY FIELD(t.priority, 'high', 'medium', 'low'), t.created_at
      LIMIT :limit`,
    {
      limit: options.limit ?? 100,
      ...(options.status ? { status: options.status } : {}),
      ...(options.category ? { category: options.category } : {}),
    },
  );

  return rows.map((row) => ({
    ...toTicket(row, []),
    username: row.username,
    ...(row.assignee ? { assignee: row.assignee } : {}),
  }));
}

/** The full conversation, internal notes included. Staff callers only. */
export async function staffGetTicket(publicId: string): Promise<StaffTicket> {
  const row = await queryOne<TicketRow & { username: string; assignee: string | null }>(
    `SELECT t.id, t.public_id, t.subject, t.category, t.priority, t.status,
            t.created_at, t.updated_at, u.username, a.name AS assignee
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN admin_users a ON a.id = t.assignee_id
      WHERE t.public_id = :publicId AND t.deleted_at IS NULL`,
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Ticket not found.');

  return {
    ...toTicket(row, await messagesFor(row.id, true)),
    username: row.username,
    ...(row.assignee ? { assignee: row.assignee } : {}),
  };
}

/**
 * A staff reply, or an internal note.
 *
 * `internal` is the difference between writing to the user and writing about
 * them, so it is an explicit argument with no default that could be got wrong
 * by omission.
 */
export async function staffReply(
  adminUserId: number,
  publicId: string,
  body: string,
  internal: boolean,
): Promise<StaffTicket> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM support_tickets WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Ticket not found.');

  await transaction(async (tx) => {
    await execute(
      `INSERT INTO ticket_messages (ticket_id, author_id, is_staff, is_internal, body)
       VALUES (:ticketId, :adminId, 1, :internal, :body)`,
      { ticketId: row.id, adminId: adminUserId, internal: internal ? 1 : 0, body },
      tx,
    );

    // An internal note is not an answer, so it does not move the ticket into
    // "waiting on the user" — that would stop the clock on a question nobody
    // has actually replied to.
    if (!internal) {
      await execute(
        `UPDATE support_tickets
            SET status = CASE WHEN status = 'open' THEN 'waiting' ELSE status END,
                assignee_id = COALESCE(assignee_id, :adminId),
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = :id`,
        { id: row.id, adminId: adminUserId },
        tx,
      );
    }
  });

  return staffGetTicket(publicId);
}

export async function staffSetStatus(
  adminUserId: number,
  publicId: string,
  status: TicketStatus,
  priority?: 'low' | 'medium' | 'high',
): Promise<StaffTicket> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM support_tickets WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Ticket not found.');

  await execute(
    `UPDATE support_tickets
        SET status = :status,
            priority = COALESCE(:priority, priority),
            assignee_id = COALESCE(assignee_id, :adminId),
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :id`,
    { status, priority: priority ?? null, adminId: adminUserId, id: row.id },
  );

  return staffGetTicket(publicId);
}
