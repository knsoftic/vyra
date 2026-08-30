'use client';

/**
 * Platform analytics — measured, never estimated. Four series over 14 days,
 * each read straight from the owning table.
 */

import { PageHeader, SectionCard, BarChart, Notice, Button } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData } from '@/lib/useAdminData';

export default function AnalyticsPage() {
  const { state, reload } = useAdminData(() => adminApi.analytics());

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Daily series for the last 14 days, read from the events the platform actually recorded."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <SectionCard title="Signups" description="New accounts per day.">
            <BarChart data={state.data.signups.map((p) => ({ label: p.day.slice(5), value: p.value }))} />
          </SectionCard>
          <SectionCard title="Videos posted" description="New videos per day.">
            <BarChart accent="var(--color-accent)" data={state.data.videos.map((p) => ({ label: p.day.slice(5), value: p.value }))} />
          </SectionCard>
          <SectionCard title="Watch time" description="Minutes watched per day, summed from watch events.">
            <BarChart accent="var(--color-info)" data={state.data.watchMinutes.map((p) => ({ label: p.day.slice(5), value: p.value }))} />
          </SectionCard>
          <SectionCard title="Gift coins" description="Coins spent on live gifts per day.">
            <BarChart accent="var(--color-warn)" data={state.data.giftCoins.map((p) => ({ label: p.day.slice(5), value: p.value }))} />
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
