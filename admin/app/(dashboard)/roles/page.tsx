'use client';

/**
 * Roles and administrators.
 *
 * Granting admin access requires an existing platform account — this screen
 * never handles credentials. Only a super admin can grant or revoke, and
 * nobody can disable themselves.
 */

import { useMemo, useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Select, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';
import { useAdminSession } from '@/lib/session';

export default function RolesPage() {
  const { state, reload } = useAdminData(() => adminApi.roles());
  const { identity } = useAdminSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleSlug, setRoleSlug] = useState('super_admin');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const isSuper = identity?.role === 'super_admin';

  const permissionCounts = useMemo(() => {
    if (state.status !== 'live') return new Map<number, number>();
    const counts = new Map<number, number>();
    for (const p of state.data.permissions) counts.set(p.roleId, (counts.get(p.roleId) ?? 0) + 1);
    return counts;
  }, [state]);

  const grant = async () => {
    if (!email.trim() || !name.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await adminApi.grantAdmin(email.trim(), name.trim(), roleSlug);
      setNote('Granted. They sign in with their existing account password.');
      setEmail('');
      setName('');
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Grant failed.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: 'active' | 'disabled') => {
    setNote(null);
    try {
      await adminApi.setAdminStatus(id, status);
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Change failed.');
    }
  };

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Who can operate the platform. Super admins bypass permission checks; every other role is limited to its grants."
      />

      {note ? <div className="mb-4"><Notice tone="info" title="Status">{note}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <SectionCard title={`Administrators — ${state.data.admins.length}`}>
              {state.data.admins.length === 0 ? (
                <EmptyState icon="key" title="No administrators" />
              ) : (
                <Table columns={['Admin', 'Role', 'Status', 'Last sign-in', 'Since', 'Act']}>
                  {state.data.admins.map((admin) => (
                    <Row key={admin.id}>
                      <Cell>
                        <div className="text-ink font-medium">{admin.name}</div>
                        <div className="text-dim">{admin.email}</div>
                      </Cell>
                      <Cell><Badge tone="brand">{admin.role}</Badge></Cell>
                      <Cell><Badge tone={admin.status === 'active' ? ('success' as Tone) : ('danger' as Tone)}>{admin.status}</Badge></Cell>
                      <Cell className="text-dim">{fmtLive.dateTime(admin.lastLoginAt)}</Cell>
                      <Cell className="text-dim">{fmtLive.date(admin.createdAt)}</Cell>
                      <Cell>
                        {isSuper ? (
                          admin.status === 'active' ? (
                            <Button size="sm" variant="danger" onClick={() => void setStatus(admin.id, 'disabled')}>Disable</Button>
                          ) : (
                            <Button size="sm" onClick={() => void setStatus(admin.id, 'active')}>Enable</Button>
                          )
                        ) : <span className="text-dim text-[11px]">super admin only</span>}
                      </Cell>
                    </Row>
                  ))}
                </Table>
              )}
            </SectionCard>

            <SectionCard title="Roles" description="Permission rows per role. Super admin bypasses the check entirely.">
              <Table columns={['Role', 'Slug', 'System', 'Permissions']}>
                {state.data.roles.map((role) => (
                  <Row key={role.id}>
                    <Cell className="text-ink font-medium">{role.name}</Cell>
                    <Cell mono className="text-dim">{role.slug}</Cell>
                    <Cell><Badge tone={role.isSystem ? 'info' : 'neutral'}>{role.isSystem ? 'system' : 'custom'}</Badge></Cell>
                    <Cell mono>{permissionCounts.get(role.id) ?? 0}</Cell>
                  </Row>
                ))}
              </Table>
            </SectionCard>
          </div>

          <SectionCard
            title="Grant admin access"
            description="The person must already have a platform account — this never creates credentials."
          >
            <div className="flex flex-col gap-3">
              <TextField label="Account email" value={email} onChange={setEmail} placeholder="person@example.com" />
              <TextField label="Display name" value={name} onChange={setName} placeholder="Their name in the audit log" />
              <Select
                value={roleSlug}
                onChange={setRoleSlug}
                options={state.data.roles.map((role) => ({ value: role.slug, label: role.name }))}
              />
              <Button variant="primary" onClick={() => void grant()} disabled={busy || !isSuper || !email.trim() || !name.trim()}>
                {isSuper ? (busy ? 'Granting…' : 'Grant access') : 'Super admin only'}
              </Button>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
