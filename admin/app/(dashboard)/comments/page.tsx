'use client';

/** Comments: search and remove. Removal goes through moderation. */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, SearchInput, TextField, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

const statusTone: Record<string, Tone> = {
  visible: 'success',
  held: 'warn',
  hidden: 'info',
  removed: 'danger',
};

export default function CommentsPage() {
  const [query, setQuery] = useState('');
  const { state, reload } = useAdminData(() => adminApi.comments(query), [query]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const remove = async (id: string) => {
    const reason = (reasons[id] ?? '').trim();
    if (reason.length < 3) {
      setOutcome('Write the reason first.');
      return;
    }
    setBusyId(id);
    setOutcome(null);
    try {
      const result = await adminApi.decide({ targetType: 'comment', targetId: id, action: 'content_removal', reason });
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
      <PageHeader title="Comments" subtitle="Latest comments across the platform." />

      {outcome ? <div className="mb-4"><Notice tone="info" title="Result">{outcome}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      <SectionCard
        title="Recent"
        action={<SearchInput placeholder="Text or username" value={query} onChange={setQuery} />}
      >
        {state.status === 'live' && state.data.items.length === 0 ? (
          <EmptyState icon="comment" title="No comments match" />
        ) : null}
        {state.status === 'live' && state.data.items.length > 0 ? (
          <Table columns={['Comment', 'Author', 'On video', 'Status', 'Reports', 'When', 'Reason', 'Act']}>
            {state.data.items.map((comment) => (
              <Row key={comment.id}>
                <Cell><div className="max-w-[220px] truncate text-ink">{comment.body}</div></Cell>
                <Cell className="text-dim">@{comment.username}</Cell>
                <Cell><div className="max-w-[140px] truncate text-dim">{comment.videoCaption ?? comment.videoId}</div></Cell>
                <Cell><Badge tone={statusTone[comment.status] ?? 'neutral'}>{comment.status}</Badge></Cell>
                <Cell mono className={comment.openReports > 0 ? 'text-danger font-semibold' : ''}>{comment.openReports}</Cell>
                <Cell className="text-dim">{fmtLive.dateTime(comment.createdAt)}</Cell>
                <Cell>
                  <TextField
                    placeholder="Reason (required)"
                    value={reasons[comment.id] ?? ''}
                    onChange={(v: string) => setReasons((prev) => ({ ...prev, [comment.id]: v }))}
                  />
                </Cell>
                <Cell>
                  <Button size="sm" variant="danger" disabled={busyId === comment.id || comment.status === 'removed'} onClick={() => void remove(comment.id)}>
                    Remove
                  </Button>
                </Cell>
              </Row>
            ))}
          </Table>
        ) : null}
      </SectionCard>
    </>
  );
}
