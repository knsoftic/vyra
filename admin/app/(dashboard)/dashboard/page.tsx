'use client';

/**
 * The front page: what is happening, and what is waiting on a human.
 *
 * Every number is live. The queue cards link straight to the module where the
 * waiting work gets done — a dashboard that shows a backlog without a door to
 * it is just an anxiety widget.
 */

import Link from 'next/link';
import { PageHeader, Stat, SectionCard, Notice, BarChart, Button } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData, fmtLive } from '@/lib/useAdminData';

const QUEUE_LINKS: { key: 'reports' | 'verification' | 'coinRequests' | 'withdrawals' | 'support' | 'campaigns'; label: string; href: string }[] = [
  { key: 'reports', label: 'Open reports', href: '/moderation' },
  { key: 'verification', label: 'Verification requests', href: '/verification' },
  { key: 'coinRequests', label: 'Coin purchases', href: '/coin-requests' },
  { key: 'withdrawals', label: 'Withdrawals', href: '/withdrawals' },
  { key: 'support', label: 'Open tickets', href: '/support' },
  { key: 'campaigns', label: 'Campaigns to review', href: '/ads' },
];

export default function DashboardPage() {
  const { state, reload } = useAdminData(async () => {
    const [dashboard, analytics] = await Promise.all([adminApi.dashboard(), adminApi.analytics()]);
    return { dashboard, analytics };
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live platform state. Every figure is read from the database on load — nothing here is sample data."
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
            <Stat label="Users" value={fmtLive.compact(state.data.dashboard.users)} icon="users" />
            <Stat label="Active 24h" value={fmtLive.compact(state.data.dashboard.activeToday)} icon="pulse" tone="success" />
            <Stat label="Signups 7d" value={fmtLive.compact(state.data.dashboard.signupsWeek)} icon="arrowUp" />
            <Stat label="Published videos" value={fmtLive.compact(state.data.dashboard.videos)} icon="video" />
            <Stat label="Live now" value={String(state.data.dashboard.liveNow)} icon="radio" tone="danger" />
            <Stat label="Gift coins 7d" value={fmtLive.compact(state.data.dashboard.money.giftCoinsWeek)} icon="gift" tone="warn" />
          </div>

          <SectionCard
            title="Waiting on a human"
            description="Queues that do not clear themselves. Click through to act."
            className="mb-5"
          >
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {QUEUE_LINKS.map((queue) => {
                const count = state.data.dashboard.queues[queue.key];
                return (
                  <Link
                    key={queue.key}
                    href={queue.href}
                    className={`rounded-xl border p-3 transition-colors hover:bg-surface-2 ${
                      count > 0 ? 'border-warn/40 bg-warn/5' : 'border-border bg-surface'
                    }`}
                  >
                    <div className={`text-2xl font-semibold tnum ${count > 0 ? 'text-warn' : 'text-ink'}`}>
                      {count}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">{queue.label}</div>
                  </Link>
                );
              })}
            </div>
          </SectionCard>

          <div className="grid lg:grid-cols-2 gap-4">
            <SectionCard title="Signups" description="New accounts per day, last 14 days.">
              <BarChart
                data={state.data.analytics.signups.map((p) => ({ label: p.day.slice(5), value: p.value }))}
              />
            </SectionCard>
            <SectionCard title="Videos posted" description="New videos per day, last 14 days.">
              <BarChart
                accent="var(--color-accent)"
                data={state.data.analytics.videos.map((p) => ({ label: p.day.slice(5), value: p.value }))}
              />
            </SectionCard>
          </div>
        </>
      ) : null}
    </>
  );
}
