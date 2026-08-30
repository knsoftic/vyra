/**
 * Verification and support.
 *
 * `documentKeys` go up; nothing about a document ever comes back. The server
 * returns a count, never a key or a URL — so there is no field here to hold one
 * and no way for the app to accidentally render a link to someone's passport.
 */

import { api } from './client';

export interface VerificationRequest {
  id: string;
  tier: 'individual' | 'creator' | 'business';
  status: 'pending' | 'reviewing' | 'more_info' | 'approved' | 'rejected';
  note?: string;
  /** How many documents were sent. Deliberately not what they are. */
  documentCount: number;
  createdAt: string;
  decidedAt?: string;
}

export type TicketCategory =
  | 'account'
  | 'payment'
  | 'coins'
  | 'video'
  | 'verification'
  | 'advertisement'
  | 'technical';

export interface TicketMessage {
  id: string;
  body: string;
  isStaff: boolean;
  authorName: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  subject: string;
  category: TicketCategory;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  messages: TicketMessage[];
  createdAt: string;
  updatedAt: string;
}

export const trust = {
  verificationRequests: () =>
    api.get<VerificationRequest[]>('/me/verification').then((r) => r.data),

  requestVerification: (tier: VerificationRequest['tier'], documentKeys: string[]) =>
    api
      .post<VerificationRequest>('/me/verification', { tier, documentKeys })
      .then((r) => r.data),

  tickets: () => api.get<Ticket[]>('/me/tickets').then((r) => r.data),

  ticket: (id: string) => api.get<Ticket>(`/me/tickets/${id}`).then((r) => r.data),

  createTicket: (input: { subject: string; category: TicketCategory; body: string }) =>
    api.post<Ticket>('/me/tickets', input).then((r) => r.data),

  replyToTicket: (id: string, body: string) =>
    api.post<Ticket>(`/me/tickets/${id}/reply`, { body }).then((r) => r.data),

  closeTicket: (id: string) => api.post<Ticket>(`/me/tickets/${id}/close`).then((r) => r.data),

  /** What came of a report. The outcome only — never who decided it or why. */
  reportOutcome: (reportId: string) =>
    api
      .get<{ status: string; outcome: string }>(`/me/reports/${reportId}/outcome`)
      .then((r) => r.data),
};
