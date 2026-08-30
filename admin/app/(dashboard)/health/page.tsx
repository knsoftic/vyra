'use client';

/**
 * System health — everything on this page is read from the running backend.
 *
 * The readiness endpoint answers 503 when a dependency is down; that is a
 * successful *report*, not a failed request, so it is read regardless of
 * status. The outbox panel is here because an outbox nobody watches is a
 * silent failure: email that quietly stops leaving the building.
 */

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Stat, SectionCard, Button, Notice } from '@/components/ui';
import {
  backend, adminApi, AdminApiError,
  type LiveHealth, type LiveReadiness, type LiveState, type OutboxStatus,
} from '@/lib/api';

export default function HealthPage() {
  const [live, setLive] = useState<LiveState<{ health: LiveHealth; readiness: LiveReadiness; outbox: OutboxStatus }>>({
    status: 'unknown',
  });

  const check = useCallback(async () => {
    try {
      const [health, readiness, outbox] = await Promise.all([
        backend.health(),
        backend.readiness(),
        adminApi.outbox(),
      ]);
      setLive({ status: 'live', data: { health, readiness, outbox } });
    } catch (err) {
      setLive({
        status: 'offline',
        message:
          err instanceof AdminApiError && err.offline
            ? 'The API is not reachable from this browser.'
            : 'The API responded with an error.',
      });
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 10_000);
    return () => clearInterval(timer);
  }, [check]);

  const uptime =
    live.status === 'live'
      ? `${Math.floor(live.data.health.uptimeSeconds / 60)}m ${Math.floor(live.data.health.uptimeSeconds % 60)}s`
      : '—';

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="Live status of the API and its dependencies, refreshed every 10 seconds."
        actions={<Button icon="refresh" variant="primary" onClick={() => void check()}>Refresh</Button>}
      />

      {live.status === 'unknown' ? (
        <Notice tone="neutral" icon="clock">Checking the API…</Notice>
      ) : live.status === 'offline' ? (
        <Notice tone="danger" icon="warning">
          {live.message} Start it with <code>npm run dev</code> in <code>backend/</code>.
        </Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="API" value="Up" icon="pulse" tone="success" hint={`v${live.data.health.version}`} />
            <Stat label="Uptime" value={uptime} icon="clock" tone="neutral" />
            <Stat
              label="Database"
              value={live.data.readiness.checks.database === 'up' ? 'Up' : 'Down'}
              icon="cpu"
              tone={live.data.readiness.checks.database === 'up' ? 'success' : 'danger'}
            />
            <Stat
              label="Redis"
              value={live.data.readiness.checks.redis === 'up' ? 'Up' : 'Down'}
              icon="pulse"
              tone={live.data.readiness.checks.redis === 'up' ? 'success' : 'warn'}
              hint={live.data.readiness.checks.redis === 'up' ? undefined : 'degraded: rate limits + presence'}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <SectionCard
              title="Outbound delivery"
              description="The outbox: what is waiting to leave, and what is carrying it."
            >
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Stat label="Pending" value={String(live.data.outbox.pending)} tone={live.data.outbox.pending > 0 ? 'warn' : 'success'} />
                <Stat label="Abandoned" value={String(live.data.outbox.abandoned)} tone={live.data.outbox.abandoned > 0 ? 'danger' : 'neutral'} />
              </div>
              <Notice tone={live.data.outbox.transport === 'smtp' ? 'info' : 'warn'}>
                Transport: <strong>{live.data.outbox.transport}</strong>
                {live.data.outbox.transport === 'console'
                  ? ' — email is logged, not delivered. Configure SMTP in App Settings → Email.'
                  : '.'}
              </Notice>
            </SectionCard>

            <SectionCard title="Not ready?" description="What a down dependency means.">
              <ul className="text-xs text-muted leading-relaxed list-disc pl-4 flex flex-col gap-1.5">
                <li><strong className="text-ink">Database down</strong> — the platform is down. Nothing works without it.</li>
                <li><strong className="text-ink">Redis down</strong> — the API keeps working: rate limiting, presence and cache degrade, correctness does not (guarded-cache design).</li>
                <li><strong className="text-ink">Console transport</strong> — codes and resets are queued correctly and delivered nowhere.</li>
                <li>Run <code>npm run preflight</code> in <code>backend/</code> for the full launch checklist.</li>
              </ul>
            </SectionCard>
          </div>
        </>
      )}
    </>
  );
}
