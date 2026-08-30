'use client';

/**
 * Coin purchase approvals.
 *
 * Manual payments: someone sent money to a platform account and typed in the
 * reference; a human checks the bank statement and answers. Approving credits
 * the coins in the same transaction as the decision — this page only asks.
 * The note is mandatory both ways: "rejected" with no reason is a support
 * ticket tomorrow.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Tone,
} from '@/components/ui';
import { adminApi, type PurchaseRow } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';


const statusTone: Record<string, Tone> = {
  pending: 'warn',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
};

export default function CoinRequestsPage() {
  const { state, reload } = useAdminData(() => adminApi.purchases());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (id: string, approve: boolean) => {
    const note = (notes[id] ?? '').trim();
    if (note.length < 3) {
      setError('Write a note first — it is recorded with the decision.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await adminApi.decidePurchase(id, approve, note);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The decision failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Coin Requests"
        subtitle="Manual coin purchases waiting for payment confirmation. Approving credits the buyer immediately."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {error ? <div className="mb-4"><Notice tone="danger" title="Problem">{error}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.length === 0 ? (
          <SectionCard title="Queue" description="Requests appear here the moment a buyer submits a reference.">
            <EmptyState icon="card" title="Nothing waiting" description="No pending coin purchases." />
          </SectionCard>
        ) : (
          <SectionCard title={`Queue — ${state.data.length} waiting`} description="Oldest first. Check the transfer against the account statement before approving.">
            <Table columns={['Buyer', 'Coins', 'Paid', 'Method', 'Reference', 'Status', 'Requested', 'Decision note', 'Act']}>
              {state.data.map((request) => (
                <Row key={request.id}>
                  <Cell><span className="text-ink font-medium">@{request.username}</span></Cell>
                  <Cell mono>{fmtLive.compact(request.coins)}</Cell>
                  <Cell mono>{request.fiatAmount} {request.fiatCurrency}</Cell>
                  <Cell>{request.method}</Cell>
                  <Cell mono className="max-w-[140px] truncate">{request.transactionRef || '—'}</Cell>
                  <Cell><Badge tone={statusTone[request.status] ?? 'neutral'}>{request.status}</Badge></Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(request.createdAt)}</Cell>
                  <Cell>
                    <TextField
                      placeholder="Checked against statement…"
                      value={notes[request.id] ?? ''}
                      onChange={(v: string) => setNotes((prev) => ({ ...prev, [request.id]: v }))}
                    />
                  </Cell>
                  <Cell>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="primary" disabled={busyId === request.id} onClick={() => void decide(request.id, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" disabled={busyId === request.id} onClick={() => void decide(request.id, false)}>
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
