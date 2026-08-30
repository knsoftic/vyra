'use client';

/**
 * Support tickets.
 *
 * Replies can be internal — visible to staff only, filtered out server-side
 * for the user (the WHERE clause, not the UI, is what keeps them private).
 * Status changes are explicit, never a side effect of replying.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Select, Toggle, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface TicketItem {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  username: string;
  assignee?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TicketMessages {
  id: string;
  subject?: string;
  messages: { id: string; body: string; isStaff: boolean; isInternal?: boolean; authorName: string; createdAt: string }[];
}

const statusTone: Record<string, Tone> = {
  open: 'warn',
  in_progress: 'info',
  waiting: 'brand',
  resolved: 'success',
  closed: 'neutral',
};

const priorityTone: Record<string, Tone> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

export default function SupportPage() {
  const { state, reload } = useAdminData(() => adminApi.tickets() as unknown as Promise<TicketItem[]>);
  const [openTicket, setOpenTicket] = useState<TicketItem | null>(null);

  return (
    <>
      <PageHeader
        title="Support Tickets"
        subtitle="Open tickets, highest priority first. Internal notes never reach the user."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.length === 0 ? (
          <SectionCard title="Queue">
            <EmptyState icon="lifebuoy" title="No open tickets" />
          </SectionCard>
        ) : (
          <SectionCard title={`Open — ${state.data.length}`}>
            <Table columns={['Ticket', 'Category', 'Priority', 'Status', 'User', 'Updated']}>
              {state.data.map((ticket) => (
                <Row key={ticket.id} onClick={() => setOpenTicket(ticket)}>
                  <Cell><span className="text-ink font-medium">{ticket.subject}</span></Cell>
                  <Cell><Badge tone="neutral">{ticket.category}</Badge></Cell>
                  <Cell><Badge tone={priorityTone[ticket.priority] ?? 'neutral'}>{ticket.priority}</Badge></Cell>
                  <Cell><Badge tone={statusTone[ticket.status] ?? 'neutral'}>{ticket.status}</Badge></Cell>
                  <Cell className="text-dim">@{ticket.username}</Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(ticket.updatedAt)}</Cell>
                </Row>
              ))}
            </Table>
          </SectionCard>
        )
      ) : null}

      {openTicket ? (
        <TicketDrawer ticket={openTicket} onClose={() => setOpenTicket(null)} onChanged={reload} />
      ) : null}
    </>
  );
}

function TicketDrawer({
  ticket,
  onClose,
  onChanged,
}: {
  ticket: TicketItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { state, reload } = useAdminData(
    () => adminApi.ticket(ticket.id) as unknown as Promise<TicketMessages>,
    [ticket.id],
  );
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState(ticket.status);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    if (!reply.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await adminApi.replyTicket(ticket.id, reply.trim(), internal);
      setReply('');
      reload();
      onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Reply failed.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (next: string) => {
    setStatus(next);
    setBusy(true);
    try {
      await adminApi.setTicketStatus(ticket.id, next);
      onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Status change failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg h-full bg-panel border-l border-border overflow-y-auto p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{ticket.subject}</h2>
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-dim">Status</span>
          <Select
            value={status}
            onChange={(v) => void changeStatus(v)}
            options={['open', 'in_progress', 'waiting', 'resolved', 'closed'].map((s) => ({ value: s, label: s }))}
          />
        </div>

        {note ? <Notice tone="danger" title="Problem">{note}</Notice> : null}

        {state.status === 'live' ? (
          <div className="flex flex-col gap-2">
            {state.data.messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-xl border p-3 text-xs ${
                  message.isInternal
                    ? 'border-warn/40 bg-warn/5'
                    : message.isStaff
                      ? 'border-brand/40 bg-brand/5'
                      : 'border-border bg-surface'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-ink">
                    {message.authorName}
                    {message.isInternal ? ' · internal note' : message.isStaff ? ' · staff' : ''}
                  </span>
                  <span className="text-dim">{fmtLive.dateTime(message.createdAt)}</span>
                </div>
                <div className="text-muted leading-relaxed whitespace-pre-wrap">{message.body}</div>
              </div>
            ))}
          </div>
        ) : state.status === 'offline' ? (
          <Notice tone="danger" title="Could not load">{state.message}</Notice>
        ) : null}

        <div className="mt-auto border-t border-border pt-3 flex flex-col gap-2">
          <TextField label="Reply" value={reply} onChange={setReply} placeholder="Write a reply…" />
          <Toggle
            checked={internal}
            onChange={setInternal}
            label="Internal note"
            description="Visible to staff only — the user never sees it."
          />
          <Button variant="primary" onClick={() => void send()} disabled={busy || !reply.trim()}>
            {busy ? 'Sending…' : internal ? 'Add internal note' : 'Send reply'}
          </Button>
        </div>
      </div>
    </div>
  );
}
