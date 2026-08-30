'use client';

/**
 * Users: search, inspect, moderate.
 *
 * Moderation actions leave through the moderation module — the record and the
 * enforcement are one transaction there (ADR-038) — so this page collects the
 * reason and the duration and hands them over, it does not flip status columns
 * itself.
 */

import { useState } from 'react';
import {
  PageHeader, Stat, SectionCard, Button, Badge, Table, Row, Cell, Avatar,
  SearchInput, Select, EmptyState, KeyValue, Notice, TextField, Tone,
} from '@/components/ui';
import { adminApi, type AdminUserRow, type AdminUserDetail } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

const statusTone: Record<string, Tone> = {
  active: 'success',
  suspended: 'warn',
  banned: 'danger',
  frozen: 'info',
};

const verifiedTone: Record<string, Tone> = {
  none: 'neutral',
  individual: 'info',
  creator: 'brand',
  business: 'warn',
};

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<AdminUserRow | null>(null);

  const { state, reload } = useAdminData(
    () => adminApi.users({ q: query, status }),
    [query, status],
  );

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Search, inspect and moderate accounts. Every action writes an audit record."
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label="Total accounts" value={fmtLive.compact(state.data.total)} icon="users" />
          <Stat label="Shown" value={String(state.data.items.length)} icon="search" />
          <Stat
            label="With open reports"
            value={String(state.data.items.filter((u) => u.openReports > 0).length)}
            icon="shield"
            tone="danger"
          />
          <Stat
            label="Verified"
            value={String(state.data.items.filter((u) => u.verified !== 'none').length)}
            icon="check"
            tone="brand"
          />
        </div>
      ) : null}

      <SectionCard
        title="Accounts"
        description="Newest first. Search matches username, email and display name."
        action={
          <div className="flex items-center gap-2">
            <SearchInput placeholder="Search users" value={query} onChange={setQuery} />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'banned', label: 'Banned' },
                { value: 'frozen', label: 'Frozen' },
              ]}
            />
          </div>
        }
      >
        {state.status === 'live' && state.data.items.length === 0 ? (
          <EmptyState icon="users" title="No accounts match" />
        ) : null}
        {state.status === 'live' && state.data.items.length > 0 ? (
          <Table columns={['User', 'Status', 'Verified', 'Videos', 'Followers', 'Reports', 'Joined']}>
            {state.data.items.map((user) => (
              <Row key={user.id} onClick={() => setSelected(user)}>
                <Cell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={user.name ?? user.username} src={user.avatar ?? undefined} />
                    <div>
                      <div className="text-ink font-medium">{user.name ?? user.username}</div>
                      <div className="text-dim">@{user.username} · {user.email}</div>
                    </div>
                  </div>
                </Cell>
                <Cell><Badge tone={statusTone[user.status] ?? 'neutral'}>{user.status}</Badge></Cell>
                <Cell><Badge tone={verifiedTone[user.verified] ?? 'neutral'}>{user.verified}</Badge></Cell>
                <Cell mono>{user.videos}</Cell>
                <Cell mono>{user.followers}</Cell>
                <Cell mono className={user.openReports > 0 ? 'text-danger font-semibold' : ''}>
                  {user.openReports}
                </Cell>
                <Cell className="text-dim">{fmtLive.date(user.joinedAt)}</Cell>
              </Row>
            ))}
          </Table>
        ) : null}
      </SectionCard>

      {selected ? (
        <UserDrawer user={selected} onClose={() => setSelected(null)} onActed={reload} />
      ) : null}
    </>
  );
}

function UserDrawer({
  user,
  onClose,
  onActed,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onActed: () => void;
}) {
  const { state } = useAdminData<AdminUserDetail>(() => adminApi.user(user.id), [user.id]);
  const [action, setAction] = useState('warning');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('72');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const act = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await adminApi.decide({
        targetType: 'user',
        targetId: user.id,
        action,
        reason: reason.trim(),
        ...(action === 'suspension' || action === 'temporary_restriction'
          ? { durationHours: Number(hours) || 72 }
          : {}),
      });
      setOutcome(result.enforced);
      onActed();
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md h-full bg-panel border-l border-border overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">@{user.username}</h2>
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>

        {state.status === 'live' ? (
          <div className="flex flex-col gap-4">
            <KeyValue
              rows={[
                { label: 'Display name', value: String(state.data.name ?? '—') },
                { label: 'Email', value: String(state.data.email) },
                { label: 'Status', value: <Badge tone={statusTone[String(state.data.status)] ?? 'neutral'}>{String(state.data.status)}</Badge> },
                { label: 'Joined', value: fmtLive.date(state.data.joinedAt) },
                { label: 'Videos', value: String(state.data.counts?.videos ?? 0) },
                { label: 'Followers', value: String(state.data.counts?.followers ?? 0) },
                { label: 'Reports (all time)', value: String(state.data.counts?.reports ?? 0) },
                { label: 'Coin balance', value: String(state.data.wallet?.coins ?? '0') },
                { label: 'Total earned', value: String(state.data.wallet?.totalEarned ?? '0') },
              ]}
            />

            <SectionCard title="Moderate" description="The reason is mandatory and lands in the audit log.">
              <div className="flex flex-col gap-3">
                <Select
                  value={action}
                  onChange={setAction}
                  options={[
                    { value: 'warning', label: 'Warn' },
                    { value: 'temporary_restriction', label: 'Restrict (temporary)' },
                    { value: 'suspension', label: 'Suspend (temporary)' },
                    { value: 'permanent_ban', label: 'Ban' },
                    { value: 'reinstate', label: 'Reinstate' },
                  ]}
                />
                {action === 'suspension' || action === 'temporary_restriction' ? (
                  <TextField label="Duration (hours)" value={hours} onChange={setHours} />
                ) : null}
                <TextField label="Reason (required)" value={reason} onChange={setReason} placeholder="Why — appears in the audit log" />
                <Button variant="danger" onClick={() => void act()} disabled={busy || !reason.trim()}>
                  {busy ? 'Applying…' : 'Apply'}
                </Button>
                {outcome ? <Notice tone="info" title="Result">{outcome}</Notice> : null}
              </div>
            </SectionCard>

            {state.data.moderation.length > 0 ? (
              <SectionCard title="Moderation history">
                <ul className="flex flex-col gap-2 text-xs">
                  {state.data.moderation.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span className="text-ink">{m.action}</span>
                      <span className="text-dim truncate">{m.reason}</span>
                      <span className="text-dim shrink-0">{fmtLive.date(m.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}
          </div>
        ) : state.status === 'offline' ? (
          <Notice tone="danger" title="Could not load">{state.message}</Notice>
        ) : null}
      </div>
    </div>
  );
}
