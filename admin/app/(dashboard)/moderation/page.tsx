'use client';

/**
 * The report queue.
 *
 * Deciding here writes the record and the enforcement in one transaction on
 * the server (ADR-038): a suspension ends sessions immediately, a removal
 * hides the video, a revert restores. The reason is mandatory — a decision
 * that cannot be explained cannot be appealed.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Select, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface ReportItem {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail?: string;
  severity: string;
  status: string;
  reporter: { username: string };
  reportCount: number;
  createdAt: string;
}

const severityTone: Record<string, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warn',
  critical: 'danger',
};

/** What can be done to each kind of target. */
const ACTIONS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  user: [
    { value: 'no_action', label: 'No action' },
    { value: 'warning', label: 'Warn' },
    { value: 'temporary_restriction', label: 'Restrict (72h)' },
    { value: 'suspension', label: 'Suspend (72h)' },
    { value: 'permanent_ban', label: 'Ban' },
  ],
  video: [
    { value: 'no_action', label: 'No action' },
    { value: 'restrict_distribution', label: 'Restrict distribution' },
    { value: 'content_removal', label: 'Remove video' },
  ],
  comment: [
    { value: 'no_action', label: 'No action' },
    { value: 'content_removal', label: 'Remove comment' },
  ],
};

export default function ModerationPage() {
  const { state, reload } = useAdminData(() => adminApi.reports() as unknown as Promise<ReportItem[]>);
  const [actions, setActions] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const decide = async (report: ReportItem) => {
    const reason = (reasons[report.id] ?? '').trim();
    if (reason.length < 3) {
      setOutcome('Write the reason first — it becomes the audit record.');
      return;
    }
    setBusyId(report.id);
    setOutcome(null);
    try {
      const result = await adminApi.decide({
        targetType: report.targetType,
        targetId: report.targetId,
        action: actions[report.id] ?? 'no_action',
        reason,
        reportId: report.id,
        durationHours: 72,
      });
      setOutcome(result.enforced);
      reload();
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : 'The decision failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Moderation"
        subtitle="Reports from users, most urgent first. A decision enforces itself in the same transaction it is recorded in."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {outcome ? <div className="mb-4"><Notice tone="info" title="Result">{outcome}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        state.data.length === 0 ? (
          <SectionCard title="Queue">
            <EmptyState icon="shield" title="Queue is clear" description="No open reports." />
          </SectionCard>
        ) : (
          <SectionCard title={`Open reports — ${state.data.length}`} description="reportCount is how many separate people reported the same thing.">
            <Table columns={['Target', 'Reason', 'Severity', 'Reports', 'Reporter', 'When', 'Action + reason', 'Act']}>
              {state.data.map((report) => (
                <Row key={report.id}>
                  <Cell>
                    <Badge tone="neutral">{report.targetType}</Badge>
                    <div className="text-dim mt-0.5 max-w-[110px] truncate">{report.targetId}</div>
                  </Cell>
                  <Cell>
                    <div className="text-ink">{report.reason}</div>
                    {report.detail ? <div className="text-dim max-w-[180px] truncate">{report.detail}</div> : null}
                  </Cell>
                  <Cell><Badge tone={severityTone[report.severity] ?? 'neutral'}>{report.severity}</Badge></Cell>
                  <Cell mono className={report.reportCount > 1 ? 'text-warn font-semibold' : ''}>{report.reportCount}</Cell>
                  <Cell className="text-dim">@{report.reporter.username}</Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(report.createdAt)}</Cell>
                  <Cell>
                    <div className="flex flex-col gap-1.5 min-w-[190px]">
                      <Select
                        value={actions[report.id] ?? 'no_action'}
                        onChange={(v) => setActions((prev) => ({ ...prev, [report.id]: v }))}
                        options={ACTIONS_BY_TYPE[report.targetType] ?? ACTIONS_BY_TYPE.user}
                      />
                      <TextField
                        placeholder="Reason (required)"
                        value={reasons[report.id] ?? ''}
                        onChange={(v: string) => setReasons((prev) => ({ ...prev, [report.id]: v }))}
                      />
                    </div>
                  </Cell>
                  <Cell>
                    <Button size="sm" variant="primary" disabled={busyId === report.id} onClick={() => void decide(report)}>
                      Decide
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
