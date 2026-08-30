'use client';

/** Communities: a read view. Member action goes through moderation. */

import {
  PageHeader, SectionCard, Badge, Table, Row, Cell, EmptyState, Notice, Button,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface CommunityRow {
  id: string; name: string; owner: string; isPrivate: number; status: string;
  members: number; pendingRequests: number; createdAt: string;
}

export default function CommunitiesPage() {
  const { state, reload } = useAdminData(() => adminApi.list<CommunityRow>('communities'));

  return (
    <>
      <PageHeader
        title="Chat & Communities"
        subtitle="Largest communities first. Suspending one goes through moderation with a reason, like everything else."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.items.length === 0 ? (
          <SectionCard title="Communities"><EmptyState icon="chat" title="No communities yet" /></SectionCard>
        ) : (
          <SectionCard title={`Communities — ${state.data.items.length}`}>
            <Table columns={['Community', 'Owner', 'Visibility', 'Status', 'Members', 'Pending joins', 'Created']}>
              {state.data.items.map((community) => (
                <Row key={community.id}>
                  <Cell><span className="text-ink font-medium">{community.name}</span></Cell>
                  <Cell className="text-dim">@{community.owner}</Cell>
                  <Cell><Badge tone={community.isPrivate ? 'warn' : 'success'}>{community.isPrivate ? 'private' : 'public'}</Badge></Cell>
                  <Cell><Badge tone={community.status === 'active' ? 'success' : 'danger'}>{community.status}</Badge></Cell>
                  <Cell mono>{fmtLive.compact(community.members)}</Cell>
                  <Cell mono>{community.pendingRequests}</Cell>
                  <Cell className="text-dim">{fmtLive.date(community.createdAt)}</Cell>
                </Row>
              ))}
            </Table>
          </SectionCard>
        )
      ) : null}
    </>
  );
}
