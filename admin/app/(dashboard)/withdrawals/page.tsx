'use client';

/**
 * Withdrawal approvals.
 *
 * The money is already held — the debit happened when the creator asked
 * (ADR-033) — so nothing here moves value except "Reject", which refunds.
 * Approve is the review; "Mark paid" is the separate, later fact of the bank
 * transfer, and it wants the payout reference so the ledger row can point at
 * something in the outside world.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Tone,
} from '@/components/ui';
import { adminApi, type WithdrawalRow } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';


const statusTone: Record<string, Tone> = {
  pending: 'warn',
  under_review: 'info',
  approved: 'brand',
  paid: 'success',
  rejected: 'danger',
};

export default function WithdrawalsPage() {
  const { state, reload } = useAdminData(() => adminApi.withdrawals());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (id: string, action: 'approve' | 'pay' | 'reject') => {
    const note = (notes[id] ?? '').trim();
    if (note.length < 3) {
      setError('Write a note first — it is recorded with the decision.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await adminApi.decideWithdrawal(id, action, note, (refs[id] ?? '').trim() || undefined);
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
        title="Withdrawals"
        subtitle="Creator payouts. The amount is already held; rejecting refunds it, marking paid settles it."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {error ? <div className="mb-4"><Notice tone="danger" title="Problem">{error}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.length === 0 ? (
          <SectionCard title="Queue">
            <EmptyState icon="trending" title="Nothing waiting" description="No withdrawal requests to review." />
          </SectionCard>
        ) : (
          <SectionCard
            title={`Queue — ${state.data.length} open`}
            description="Approve after checking the destination; mark paid only once the transfer has actually gone out."
          >
            <Table columns={['Creator', 'Net payout', 'Fee', 'Destination', 'Status', 'Requested', 'Note / payout ref', 'Act']}>
              {state.data.map((w) => (
                <Row key={w.id}>
                  <Cell><span className="text-ink font-medium">@{w.username}</span></Cell>
                  <Cell mono>{w.netAmount} {w.currency}</Cell>
                  <Cell mono className="text-dim">{w.fee}</Cell>
                  <Cell mono className="max-w-[160px] truncate">{w.destinationFull ?? '—'}</Cell>
                  <Cell><Badge tone={statusTone[w.status] ?? 'neutral'}>{w.status}</Badge></Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(w.createdAt)}</Cell>
                  <Cell>
                    <div className="flex flex-col gap-1.5 min-w-[180px]">
                      <TextField
                        placeholder="Decision note (required)"
                        value={notes[w.id] ?? ''}
                        onChange={(v: string) => setNotes((prev) => ({ ...prev, [w.id]: v }))}
                      />
                      {w.status === 'approved' ? (
                        <TextField
                          placeholder="Payout reference"
                          value={refs[w.id] ?? ''}
                          onChange={(v: string) => setRefs((prev) => ({ ...prev, [w.id]: v }))}
                        />
                      ) : null}
                    </div>
                  </Cell>
                  <Cell>
                    <div className="flex gap-1.5">
                      {w.status === 'approved' ? (
                        <Button size="sm" variant="primary" disabled={busyId === w.id} onClick={() => void decide(w.id, 'pay')}>
                          Mark paid
                        </Button>
                      ) : (
                        <Button size="sm" variant="primary" disabled={busyId === w.id} onClick={() => void decide(w.id, 'approve')}>
                          Approve
                        </Button>
                      )}
                      <Button size="sm" variant="danger" disabled={busyId === w.id} onClick={() => void decide(w.id, 'reject')}>
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
