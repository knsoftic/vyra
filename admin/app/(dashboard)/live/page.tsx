'use client';

/**
 * Live streams. Stopping one ends it for every viewer immediately and the
 * reason reaches the host — cutting a broadcast without a word is how support
 * queues are made.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface LiveRow {
  id: string; title: string; category: string | null; status: string; host: string;
  viewers: number; peakViewers: number; likes: number;
  startedAt: string | null; endedAt: string | null; createdAt: string;
}

const statusTone: Record<string, Tone> = {
  live: 'danger',
  scheduled: 'info',
  ended: 'neutral',
  stopped_by_admin: 'warn',
};

export default function LivePage() {
  const { state, reload } = useAdminData(() => adminApi.list<LiveRow>('live'));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const stop = async (id: string) => {
    const reason = (reasons[id] ?? '').trim();
    if (reason.length < 3) {
      setOutcome('Write the reason first — the host sees it.');
      return;
    }
    setBusyId(id);
    setOutcome(null);
    try {
      await adminApi.stopLive(id, reason);
      setOutcome('Stream stopped.');
      reload();
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : 'Stop failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Live Streams" subtitle="Streams on air first, then recent history." actions={<Button icon="refresh" onClick={reload}>Refresh</Button>} />

      {outcome ? <div className="mb-4"><Notice tone="info" title="Result">{outcome}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.items.length === 0 ? (
          <SectionCard title="Streams"><EmptyState icon="radio" title="No streams yet" /></SectionCard>
        ) : (
          <SectionCard title="Streams">
            <Table columns={['Stream', 'Host', 'Status', 'Viewers', 'Peak', 'Likes', 'Started', 'Reason', 'Act']}>
              {state.data.items.map((stream) => (
                <Row key={stream.id}>
                  <Cell><div className="max-w-[180px] truncate text-ink">{stream.title}</div></Cell>
                  <Cell className="text-dim">@{stream.host}</Cell>
                  <Cell><Badge tone={statusTone[stream.status] ?? 'neutral'} dot={stream.status === 'live'}>{stream.status}</Badge></Cell>
                  <Cell mono>{stream.viewers}</Cell>
                  <Cell mono>{stream.peakViewers}</Cell>
                  <Cell mono>{fmtLive.compact(stream.likes)}</Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(stream.startedAt)}</Cell>
                  <Cell>
                    {stream.status === 'live' ? (
                      <TextField
                        placeholder="Reason (host sees it)"
                        value={reasons[stream.id] ?? ''}
                        onChange={(v: string) => setReasons((prev) => ({ ...prev, [stream.id]: v }))}
                      />
                    ) : <span className="text-dim">—</span>}
                  </Cell>
                  <Cell>
                    {stream.status === 'live' ? (
                      <Button size="sm" variant="danger" disabled={busyId === stream.id} onClick={() => void stop(stream.id)}>
                        Stop
                      </Button>
                    ) : null}
                  </Cell>
                </Row>
              ))}
            </Table>
          </SectionCard>
        )
      ) : null}
    </>
  );
}
