'use client';

/**
 * Notifications: the delivery queue, and the megaphone.
 *
 * The outbox panel is the honest view of delivery — including which transport
 * is actually carrying messages. An announcement goes to every active user's
 * in-app inbox in one statement; it deliberately does not push or email,
 * because a megaphone that can page every phone belongs behind a push provider
 * that exists.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Stat, Table, Row, Cell,
  EmptyState, Notice, TextField,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

export default function NotificationsPage() {
  const { state, reload } = useAdminData(async () => {
    const [outbox, campaigns] = await Promise.all([adminApi.outbox(), adminApi.notificationCampaigns()]);
    return { outbox, campaigns: campaigns.items };
  });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const drain = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await adminApi.drainOutbox();
      setNote(`Drain finished: ${result.sent} sent, ${result.failed} failed, ${result.abandoned} abandoned — via ${result.transport}.`);
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Drain failed.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!title.trim() || !body.trim() || busy) return;
    // Two clicks on purpose — a native confirm() is swallowed by some
    // embedded browsers, and a one-click send to every user is a footgun.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setNote(null);
    try {
      const result = await adminApi.sendCampaign(title.trim(), body.trim());
      setNote(`Sent to ${result.recipients} inboxes.`);
      setTitle('');
      setBody('');
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="The outbound delivery queue, and platform announcements."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {note ? <div className="mb-4"><Notice tone="info" title="Status">{note}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Pending" value={String(state.data.outbox.pending)} icon="bell" tone={state.data.outbox.pending > 0 ? 'warn' : 'success'} />
            <Stat label="Retrying" value={String(state.data.outbox.failed)} icon="refresh" tone="info" />
            <Stat label="Abandoned" value={String(state.data.outbox.abandoned)} icon="close" tone={state.data.outbox.abandoned > 0 ? 'danger' : 'neutral'} />
            <Stat
              label="Transport"
              value={state.data.outbox.transport}
              icon="bell"
              tone={state.data.outbox.transport === 'smtp' ? 'success' : 'warn'}
              hint={state.data.outbox.transport === 'console' ? 'Not delivering — configure SMTP in Settings' : undefined}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <SectionCard
              title="Outbox"
              description="Messages waiting to leave the platform. The drain runs on demand here, or on a schedule in production."
              action={<Button size="sm" onClick={() => void drain()} disabled={busy}>{busy ? 'Draining…' : 'Drain now'}</Button>}
            >
              <Notice tone={state.data.outbox.transport === 'smtp' ? 'info' : 'warn'} title={state.data.outbox.transport === 'smtp' ? 'Delivering over SMTP' : 'Console transport'}>
                {state.data.outbox.transport === 'smtp'
                  ? 'Email leaves through the configured SMTP server.'
                  : 'No SMTP is configured, so email is written to the server log instead of delivered. Set it up under App Settings → Email.'}
              </Notice>
              {state.data.outbox.oldestPendingAgeSeconds !== null ? (
                <p className="text-xs text-muted mt-3">
                  Oldest pending message has waited {Math.round(state.data.outbox.oldestPendingAgeSeconds / 60)} minutes.
                </p>
              ) : (
                <p className="text-xs text-muted mt-3">Nothing is waiting.</p>
              )}
            </SectionCard>

            <SectionCard
              title="Announcement"
              description="Lands in every active user's in-app inbox as a system notification. No push, no email."
            >
              <div className="flex flex-col gap-3">
                <TextField label="Title" value={title} onChange={setTitle} placeholder="Scheduled maintenance" />
                <TextField label="Message" value={body} onChange={setBody} placeholder="What users should know…" />
                <Button
                  variant={confirming ? 'danger' : 'primary'}
                  onClick={() => void send()}
                  disabled={busy || !title.trim() || !body.trim()}
                >
                  {busy ? 'Sending…' : confirming ? 'Press again to confirm' : 'Send to all users'}
                </Button>
                {confirming ? (
                  <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                ) : null}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Past announcements" className="mt-4">
            {state.data.campaigns.length === 0 ? (
              <EmptyState icon="bell" title="Nothing sent yet" />
            ) : (
              <Table columns={['Title', 'Message', 'Status', 'Recipients', 'Sent']}>
                {state.data.campaigns.map((c) => (
                  <Row key={c.id}>
                    <Cell><span className="text-ink font-medium">{c.title}</span></Cell>
                    <Cell className="text-dim max-w-[260px] truncate">{c.body}</Cell>
                    <Cell><Badge tone={c.status === 'sent' ? 'success' : 'neutral'}>{c.status}</Badge></Cell>
                    <Cell mono>{fmtLive.compact(c.sentCount)}</Cell>
                    <Cell className="text-dim">{fmtLive.dateTime(c.createdAt)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </SectionCard>
        </>
      ) : null}
    </>
  );
}
