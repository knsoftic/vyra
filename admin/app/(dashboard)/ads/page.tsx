'use client';

/**
 * Campaign review.
 *
 * Approval starts delivery; rejection returns the whole held budget. Promotion
 * buys distribution and is labelled in the feed (ADR-035) — it never buys
 * likes, followers or comments, so there is nothing here that edits numbers.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface CampaignItem {
  id: string;
  name: string;
  username: string;
  kind?: string;
  objective: string;
  status: string;
  budgetCoins: number;
  spentCoins: number;
  createdAt: string;
}

export default function AdsPage() {
  const { state, reload } = useAdminData(() => adminApi.campaigns() as unknown as Promise<CampaignItem[]>);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const review = async (id: string, approve: boolean) => {
    setBusyId(id);
    setMessage(null);
    try {
      await adminApi.reviewCampaign(id, approve, (notes[id] ?? '').trim() || undefined);
      setMessage(approve ? 'Approved — delivery starts on the next feed request.' : 'Rejected — the budget was returned.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The review failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Ad Campaigns"
        subtitle="Campaigns waiting for review. Approval starts spending the advertiser's held budget; rejection refunds it in full."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {message ? <div className="mb-4"><Notice tone="info" title="Status">{message}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.length === 0 ? (
          <SectionCard title="Review queue">
            <EmptyState icon="megaphone" title="Nothing to review" description="Campaigns land here when an advertiser submits one." />
          </SectionCard>
        ) : (
          <SectionCard title={`Waiting — ${state.data.length}`}>
            <Table columns={['Campaign', 'Advertiser', 'Objective', 'Budget', 'Submitted', 'Note', 'Act']}>
              {state.data.map((campaign) => (
                <Row key={campaign.id}>
                  <Cell><span className="text-ink font-medium">{campaign.name}</span></Cell>
                  <Cell className="text-dim">@{campaign.username}</Cell>
                  <Cell><Badge tone="info">{campaign.objective}</Badge></Cell>
                  <Cell mono>{fmtLive.compact(campaign.budgetCoins)} coins</Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(campaign.createdAt)}</Cell>
                  <Cell>
                    <TextField
                      placeholder="Optional note to the advertiser"
                      value={notes[campaign.id] ?? ''}
                      onChange={(v: string) => setNotes((prev) => ({ ...prev, [campaign.id]: v }))}
                    />
                  </Cell>
                  <Cell>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="primary" disabled={busyId === campaign.id} onClick={() => void review(campaign.id, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" disabled={busyId === campaign.id} onClick={() => void review(campaign.id, false)}>
                        Reject
                      </Button>
                    </div>
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
