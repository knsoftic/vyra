'use client';

/** Banners: create drafts, take them live, end them. */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, TextField, Select, Tone,
} from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

interface BannerRow {
  id: number; title: string; subtitle: string | null; placement: string; status: string;
  ctaLabel: string | null; ctaUrl: string | null; impressions: number; clicks: number; createdAt: string;
}

const statusTone: Record<string, Tone> = {
  draft: 'neutral', scheduled: 'info', live: 'success', ended: 'warn',
};

export default function BannersPage() {
  const { state, reload } = useAdminData(() => adminApi.list<BannerRow>('banners'));
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [placement, setPlacement] = useState('explore_top');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await adminApi.createBanner({ title: title.trim(), subtitle: subtitle.trim() || undefined, placement });
      setTitle('');
      setSubtitle('');
      setNote('Created as a draft. Take it live from the table.');
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: number, status: string) => {
    setNote(null);
    try {
      await adminApi.setBannerStatus(id, status);
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  return (
    <>
      <PageHeader title="Banners & Promos" subtitle="In-app promotional banners. Drafts are invisible until taken live." />

      {note ? <div className="mb-4"><Notice tone="info" title="Status">{note}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <SectionCard title="New banner">
          <div className="flex flex-col gap-3">
            <TextField label="Title" value={title} onChange={setTitle} />
            <TextField label="Subtitle" value={subtitle} onChange={setSubtitle} />
            <Select
              value={placement}
              onChange={setPlacement}
              options={[
                { value: 'explore_top', label: 'Explore — top' },
                { value: 'home_promo', label: 'Home promo' },
                { value: 'campaign_banner', label: 'Campaign banner' },
              ]}
            />
            <Button variant="primary" onClick={() => void create()} disabled={busy || !title.trim()}>Create draft</Button>
          </div>
        </SectionCard>

        <div className="lg:col-span-2">
          {state.status === 'live' ? (
            state.data.items.length === 0 ? (
              <SectionCard title="Banners"><EmptyState icon="image" title="No banners yet" /></SectionCard>
            ) : (
              <SectionCard title={`Banners — ${state.data.items.length}`}>
                <Table columns={['Banner', 'Placement', 'Status', 'Impressions', 'Clicks', 'Created', 'Act']}>
                  {state.data.items.map((banner) => (
                    <Row key={banner.id}>
                      <Cell>
                        <div className="text-ink font-medium">{banner.title}</div>
                        {banner.subtitle ? <div className="text-dim">{banner.subtitle}</div> : null}
                      </Cell>
                      <Cell><Badge tone="neutral">{banner.placement}</Badge></Cell>
                      <Cell><Badge tone={statusTone[banner.status] ?? 'neutral'}>{banner.status}</Badge></Cell>
                      <Cell mono>{fmtLive.compact(banner.impressions)}</Cell>
                      <Cell mono>{fmtLive.compact(banner.clicks)}</Cell>
                      <Cell className="text-dim">{fmtLive.date(banner.createdAt)}</Cell>
                      <Cell>
                        <div className="flex gap-1.5">
                          {banner.status !== 'live' ? (
                            <Button size="sm" variant="primary" onClick={() => void setStatus(banner.id, 'live')}>Go live</Button>
                          ) : (
                            <Button size="sm" variant="danger" onClick={() => void setStatus(banner.id, 'ended')}>End</Button>
                          )}
                        </div>
                      </Cell>
                    </Row>
                  ))}
                </Table>
              </SectionCard>
            )
          ) : null}
        </div>
      </div>
    </>
  );
}
