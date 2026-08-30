'use client';

/** Security: recent security events and admin sign-in attempts. Read-only. */

import {
  PageHeader, SectionCard, Badge, Table, Row, Cell, EmptyState, Notice, Button,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

export default function SecurityPage() {
  const { state, reload } = useAdminData(() => adminApi.security());

  return (
    <>
      <PageHeader
        title="Security"
        subtitle="The security event stream: sign-ins, password changes, moderation actions, document views."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="flex flex-col gap-4">
          <SectionCard title="Recent events" description="Latest 100, newest first.">
            {state.data.events.length === 0 ? (
              <EmptyState icon="lock" title="No events" />
            ) : (
              <Table columns={['Event', 'Outcome', 'User', 'Detail', 'IP', 'When']}>
                {state.data.events.map((event) => (
                  <Row key={event.id}>
                    <Cell><span className="text-ink">{event.event}</span></Cell>
                    <Cell>
                      <Badge tone={event.outcome === 'success' ? 'success' : event.outcome === 'blocked' ? 'danger' : 'warn'}>
                        {event.outcome}
                      </Badge>
                    </Cell>
                    <Cell className="text-dim">{event.username ? `@${event.username}` : '—'}</Cell>
                    <Cell><div className="max-w-[260px] truncate text-dim">{event.detail ?? '—'}</div></Cell>
                    <Cell mono className="text-dim">{event.ip ?? '—'}</Cell>
                    <Cell className="text-dim">{fmtLive.dateTime(event.createdAt)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
