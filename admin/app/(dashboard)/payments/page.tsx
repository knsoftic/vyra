'use client';

/**
 * Payments: every movement of real money, in and out, whatever its state.
 * Read-only — approvals happen in Coin Requests and Withdrawals.
 */

import {
  PageHeader, SectionCard, Badge, Table, Row, Cell, EmptyState, Notice, Button, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface PaymentRow {
  id: string; username: string; coins?: number; amount: number; netAmount?: number;
  currency: string; method: string | null; status: string; reference: string | null;
  createdAt: string; decidedAt: string | null;
}

const statusTone: Record<string, Tone> = {
  pending: 'warn', under_review: 'info', approved: 'brand',
  paid: 'success', rejected: 'danger', cancelled: 'neutral',
};

export default function PaymentsPage() {
  const { state, reload } = useAdminData(
    () => (adminApi.list('payments') as unknown) as Promise<{ purchases: PaymentRow[]; withdrawals: PaymentRow[] }>,
  );

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Money in (coin purchases) and money out (withdrawals). Decisions happen in their own queues."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="flex flex-col gap-4">
          <SectionCard title={`Coin purchases — latest ${state.data.purchases.length}`}>
            {state.data.purchases.length === 0 ? (
              <EmptyState icon="card" title="No purchases yet" />
            ) : (
              <Table columns={['Buyer', 'Coins', 'Paid', 'Method', 'Status', 'Reference', 'Requested', 'Decided']}>
                {state.data.purchases.map((p) => (
                  <Row key={p.id}>
                    <Cell className="text-ink">@{p.username}</Cell>
                    <Cell mono>{fmtLive.compact(p.coins ?? 0)}</Cell>
                    <Cell mono>{p.amount} {p.currency}</Cell>
                    <Cell className="text-dim">{p.method ?? '—'}</Cell>
                    <Cell><Badge tone={statusTone[p.status] ?? 'neutral'}>{p.status}</Badge></Cell>
                    <Cell mono><div className="max-w-[120px] truncate">{p.reference ?? '—'}</div></Cell>
                    <Cell className="text-dim">{fmtLive.dateTime(p.createdAt)}</Cell>
                    <Cell className="text-dim">{fmtLive.dateTime(p.decidedAt)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </SectionCard>

          <SectionCard title={`Withdrawals — latest ${state.data.withdrawals.length}`}>
            {state.data.withdrawals.length === 0 ? (
              <EmptyState icon="trending" title="No withdrawals yet" />
            ) : (
              <Table columns={['Creator', 'Amount', 'Net', 'Method', 'Status', 'Payout ref', 'Requested', 'Decided']}>
                {state.data.withdrawals.map((w) => (
                  <Row key={w.id}>
                    <Cell className="text-ink">@{w.username}</Cell>
                    <Cell mono>{w.amount} {w.currency}</Cell>
                    <Cell mono>{w.netAmount ?? '—'}</Cell>
                    <Cell className="text-dim">{w.method ?? '—'}</Cell>
                    <Cell><Badge tone={statusTone[w.status] ?? 'neutral'}>{w.status}</Badge></Cell>
                    <Cell mono><div className="max-w-[120px] truncate">{w.reference ?? '—'}</div></Cell>
                    <Cell className="text-dim">{fmtLive.dateTime(w.createdAt)}</Cell>
                    <Cell className="text-dim">{fmtLive.dateTime(w.decidedAt)}</Cell>
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
