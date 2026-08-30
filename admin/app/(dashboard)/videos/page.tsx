'use client';

/**
 * Videos: search and moderate. Removal and restriction go through the
 * moderation module so the record and the enforcement stay one transaction.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, SearchInput, Select, TextField, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

const statusTone: Record<string, Tone> = {
  published: 'success',
  processing: 'info',
  draft: 'neutral',
  removed: 'danger',
  failed: 'danger',
};

export default function VideosPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const { state, reload } = useAdminData(() => adminApi.videos({ q: query, status }), [query, status]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const act = async (id: string, action: string) => {
    const reason = (reasons[id] ?? '').trim();
    if (reason.length < 3) {
      setOutcome('Write the reason first.');
      return;
    }
    setBusyId(id);
    setOutcome(null);
    try {
      const result = await adminApi.decide({ targetType: 'video', targetId: id, action, reason });
      setOutcome(result.enforced);
      reload();
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : 'The action failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Videos" subtitle="Newest first. Removal goes through moderation and is reversible." />

      {outcome ? <div className="mb-4"><Notice tone="info" title="Result">{outcome}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      <SectionCard
        title="Library"
        action={
          <div className="flex items-center gap-2">
            <SearchInput placeholder="Caption or username" value={query} onChange={setQuery} />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'published', label: 'Published' },
                { value: 'processing', label: 'Processing' },
                { value: 'removed', label: 'Removed' },
              ]}
            />
          </div>
        }
      >
        {state.status === 'live' && state.data.items.length === 0 ? (
          <EmptyState icon="video" title="No videos match" />
        ) : null}
        {state.status === 'live' && state.data.items.length > 0 ? (
          <Table columns={['Video', 'Creator', 'Status', 'Views', 'Likes', 'Reports', 'Posted', 'Reason', 'Act']}>
            {state.data.items.map((video) => (
              <Row key={video.id}>
                <Cell><div className="max-w-[200px] truncate text-ink">{video.caption || '(no caption)'}</div></Cell>
                <Cell className="text-dim">@{video.username}</Cell>
                <Cell><Badge tone={statusTone[video.status] ?? 'neutral'}>{video.status}</Badge></Cell>
                <Cell mono>{fmtLive.compact(video.views)}</Cell>
                <Cell mono>{fmtLive.compact(video.likes)}</Cell>
                <Cell mono className={video.openReports > 0 ? 'text-danger font-semibold' : ''}>{video.openReports}</Cell>
                <Cell className="text-dim">{fmtLive.date(video.createdAt)}</Cell>
                <Cell>
                  <TextField
                    placeholder="Reason (required)"
                    value={reasons[video.id] ?? ''}
                    onChange={(v: string) => setReasons((prev) => ({ ...prev, [video.id]: v }))}
                  />
                </Cell>
                <Cell>
                  <div className="flex gap-1.5">
                    {video.status === 'removed' ? (
                      <Button size="sm" disabled={busyId === video.id} onClick={() => void act(video.id, 'reinstate')}>
                        Restore
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" disabled={busyId === video.id} onClick={() => void act(video.id, 'restrict_distribution')}>
                          Restrict
                        </Button>
                        <Button size="sm" variant="danger" disabled={busyId === video.id} onClick={() => void act(video.id, 'content_removal')}>
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        ) : null}
      </SectionCard>
    </>
  );
}
