'use client';

/**
 * Verification review.
 *
 * Documents are never in this page's data — only their ids. Viewing one issues
 * a five-minute link signed to the reviewer who asked, and that request itself
 * is logged against the applicant's account (ADR-037). The decision destroys
 * the documents; the decision row survives.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Select, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface QueueRow {
  id: string;
  tier: string;
  status: string;
  note?: string;
  username: string;
  displayName: string;
  followers: number;
  accountCreatedAt: string;
  documentIds: string[];
  documentCount: number;
  createdAt: string;
}

const statusTone: Record<string, Tone> = {
  pending: 'warn',
  reviewing: 'info',
  more_info: 'brand',
  approved: 'success',
  rejected: 'danger',
};

export default function VerificationPage() {
  const { state, reload } = useAdminData(() => adminApi.verificationQueue() as unknown as Promise<QueueRow[]>);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decide = async (id: string) => {
    const decision = decisions[id] ?? 'approved';
    setBusyId(id);
    setMessage(null);
    try {
      await adminApi.decideVerification(id, decision, (notes[id] ?? '').trim() || undefined);
      setMessage('Decision recorded. Documents for finalised requests are destroyed.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The decision failed.');
    } finally {
      setBusyId(null);
    }
  };

  const viewDocument = async (documentId: string) => {
    setMessage(null);
    try {
      const link = await adminApi.documentLink(documentId);
      window.open(link.url, '_blank', 'noopener');
      setMessage(`Viewing link issued — it expires in ${link.expiresInSeconds}s and the request was logged against the applicant's account.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not issue a viewing link.');
    }
  };

  return (
    <>
      <PageHeader
        title="Verification"
        subtitle="Identity review. Opening a document is itself a logged event; deciding destroys the files."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {message ? <div className="mb-4"><Notice tone="info" title="Status">{message}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.length === 0 ? (
          <SectionCard title="Queue">
            <EmptyState icon="check" title="Queue is clear" description="No verification requests waiting." />
          </SectionCard>
        ) : (
          <SectionCard title={`Queue — ${state.data.length} waiting`} description="Oldest first.">
            <Table columns={['Applicant', 'Tier', 'Status', 'Followers', 'Account age', 'Documents', 'Decision', 'Act']}>
              {state.data.map((request) => (
                <Row key={request.id}>
                  <Cell>
                    <div className="text-ink font-medium">{request.displayName}</div>
                    <div className="text-dim">@{request.username}</div>
                  </Cell>
                  <Cell><Badge tone="brand">{request.tier}</Badge></Cell>
                  <Cell><Badge tone={statusTone[request.status] ?? 'neutral'}>{request.status}</Badge></Cell>
                  <Cell mono>{fmtLive.compact(request.followers)}</Cell>
                  <Cell className="text-dim">{fmtLive.date(request.accountCreatedAt)}</Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-1">
                      {request.documentIds.map((docId, index) => (
                        <Button key={docId} size="sm" onClick={() => void viewDocument(docId)}>
                          Doc {index + 1}
                        </Button>
                      ))}
                      {request.documentIds.length === 0 ? <span className="text-dim">none</span> : null}
                    </div>
                  </Cell>
                  <Cell>
                    <div className="flex flex-col gap-1.5 min-w-[170px]">
                      <Select
                        value={decisions[request.id] ?? 'approved'}
                        onChange={(v) => setDecisions((prev) => ({ ...prev, [request.id]: v }))}
                        options={[
                          { value: 'approved', label: 'Approve' },
                          { value: 'rejected', label: 'Reject' },
                          { value: 'more_info', label: 'Ask for more info' },
                        ]}
                      />
                      <TextField
                        placeholder="Note to the applicant"
                        value={notes[request.id] ?? ''}
                        onChange={(v: string) => setNotes((prev) => ({ ...prev, [request.id]: v }))}
                      />
                    </div>
                  </Cell>
                  <Cell>
                    <Button size="sm" variant="primary" disabled={busyId === request.id} onClick={() => void decide(request.id)}>
                      Submit
                    </Button>
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
