'use client';

/** AI models and experiments — the record of what ranks the feed. Read-only. */

import {
  PageHeader, SectionCard, Badge, Table, Row, Cell, EmptyState, Notice, Button, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

const statusTone: Record<string, Tone> = {
  active: 'success', shadow: 'info', draft: 'neutral', rolled_back: 'warn', retired: 'neutral',
  running: 'info', completed: 'success', cancelled: 'neutral',
};

export default function ModelsPage() {
  const { state, reload } = useAdminData(() => adminApi.models());

  return (
    <>
      <PageHeader
        title="AI Models"
        subtitle="Ranking model versions and experiments. The active model is what orders every feed right now."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="flex flex-col gap-4">
          <SectionCard title="Model versions">
            {state.data.models.length === 0 ? (
              <EmptyState icon="cpu" title="No model rows" description="The rules-based ranker is running from ranking weights." />
            ) : (
              <Table columns={['Version', 'Approach', 'Status', 'Notes', 'Activated', 'Created']}>
                {state.data.models.map((model) => (
                  <Row key={model.id}>
                    <Cell mono className="text-ink">{String(model.version)}</Cell>
                    <Cell><Badge tone="neutral">{String(model.approach)}</Badge></Cell>
                    <Cell><Badge tone={statusTone[String(model.status)] ?? 'neutral'}>{String(model.status)}</Badge></Cell>
                    <Cell><div className="max-w-[260px] truncate text-dim">{String(model.notes ?? '—')}</div></Cell>
                    <Cell className="text-dim">{fmtLive.date(model.activatedAt)}</Cell>
                    <Cell className="text-dim">{fmtLive.date(model.createdAt)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </SectionCard>

          <SectionCard title="Experiments">
            {state.data.experiments.length === 0 ? (
              <EmptyState icon="chart" title="No experiments" />
            ) : (
              <Table columns={['Experiment', 'Hypothesis', 'Metric', 'Status', 'Started', 'Ended']}>
                {state.data.experiments.map((experiment) => (
                  <Row key={experiment.id}>
                    <Cell mono className="text-ink">{String(experiment.experimentId)}</Cell>
                    <Cell><div className="max-w-[280px] truncate text-dim">{String(experiment.hypothesis)}</div></Cell>
                    <Cell className="text-dim">{String(experiment.primaryMetric)}</Cell>
                    <Cell><Badge tone={statusTone[String(experiment.status)] ?? 'neutral'}>{String(experiment.status)}</Badge></Cell>
                    <Cell className="text-dim">{fmtLive.date(experiment.startedAt)}</Cell>
                    <Cell className="text-dim">{fmtLive.date(experiment.endedAt)}</Cell>
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
