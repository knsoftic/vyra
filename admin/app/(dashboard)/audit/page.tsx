'use client';

/**
 * The audit log. Append-only — there is no delete path anywhere in the
 * codebase, because an audit log a bad actor can edit is not an audit log.
 */

import {
  PageHeader, SectionCard, Badge, Table, Row, Cell, EmptyState, Notice, Button,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

export default function AuditPage() {
  const { state, reload } = useAdminData(() => adminApi.audit());

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Who changed what, and why. Every admin mutation writes here; nothing deletes from it."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <SectionCard title={`Latest ${state.data.length} entries`}>
          {state.data.length === 0 ? (
            <EmptyState icon="list" title="No entries yet" />
          ) : (
            <Table columns={['Admin', 'Module', 'Action', 'Target', 'Change', 'Reason', 'When']}>
              {state.data.map((entry) => (
                <Row key={entry.id}>
                  <Cell>
                    <div className="text-ink">{entry.adminName}</div>
                    <div className="text-dim">{entry.roleSlug}</div>
                  </Cell>
                  <Cell><Badge tone="neutral">{entry.module}</Badge></Cell>
                  <Cell className="text-ink">{entry.action}</Cell>
                  <Cell className="text-dim">
                    <div className="max-w-[140px] truncate">{entry.targetType ? `${entry.targetType} · ${entry.targetId}` : '—'}</div>
                  </Cell>
                  <Cell>
                    <div className="max-w-[220px] truncate text-dim">
                      {entry.oldValue ? `${entry.oldValue} → ` : ''}{entry.newValue ?? '—'}
                    </div>
                  </Cell>
                  <Cell><div className="max-w-[160px] truncate text-dim">{entry.reason ?? '—'}</div></Cell>
                  <Cell className="text-dim">{fmtLive.dateTime(entry.createdAt)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
