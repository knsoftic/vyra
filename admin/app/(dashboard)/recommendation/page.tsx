'use client';

/**
 * Ranking weights. Every change wants a reason because a ranking change alters
 * what millions of people see — six months later "who changed this and why"
 * has to have an answer.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell, Notice, TextField,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData } from '@/lib/useAdminData';

interface WeightSpec {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  group: string;
  description: string;
}

export default function RecommendationPage() {
  const { state, reload } = useAdminData(() => adminApi.rankingWeights() as unknown as Promise<WeightSpec[]>);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async (weight: WeightSpec) => {
    const draft = drafts[weight.key];
    const reason = (reasons[weight.key] ?? '').trim();
    if (draft === undefined || Number(draft) === weight.value) return;
    if (!reason) {
      setNote(`'${weight.label}' needs a reason — it is the audit record.`);
      return;
    }
    setBusyKey(weight.key);
    setNote(null);
    try {
      await adminApi.saveWeight(weight.key, Number(draft), reason);
      setNote(`${weight.label} saved.`);
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Recommendation"
        subtitle="The ranking formula's live weights. Bounded server-side; every change needs a written reason."
      />

      {note ? <div className="mb-4"><Notice tone="info" title="Status">{note}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <SectionCard title={`Weights — ${state.data.length}`} description="Change the value, write the reason, save. Bounds are enforced by the server.">
          <Table columns={['Weight', 'Group', 'Value', 'Bounds', 'Reason', 'Act']}>
            {state.data.map((weight) => (
              <Row key={weight.key}>
                <Cell>
                  <div className="text-ink font-medium">{weight.label}</div>
                  <div className="text-dim max-w-[240px] truncate">{weight.description}</div>
                </Cell>
                <Cell><Badge tone="neutral">{weight.group}</Badge></Cell>
                <Cell>
                  <input
                    className="bg-surface-2 border border-border rounded-md px-2 py-1 text-xs w-20 outline-none focus:border-brand tnum"
                    value={drafts[weight.key] ?? String(weight.value)}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [weight.key]: e.target.value }))}
                  />
                </Cell>
                <Cell mono className="text-dim">{weight.min} … {weight.max}</Cell>
                <Cell>
                  <TextField
                    placeholder="Why (required)"
                    value={reasons[weight.key] ?? ''}
                    onChange={(v: string) => setReasons((prev) => ({ ...prev, [weight.key]: v }))}
                  />
                </Cell>
                <Cell>
                  <Button size="sm" variant="primary" disabled={busyKey === weight.key} onClick={() => void save(weight)}>
                    Save
                  </Button>
                </Cell>
              </Row>
            ))}
          </Table>
        </SectionCard>
      ) : null}
    </>
  );
}
