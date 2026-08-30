'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAdminSession } from '@/lib/session';
import { useState } from 'react';
import { Icon, IconName } from './Icon';
import { navigation } from '@/lib/nav';
import { monetizationStats } from '@/lib/monetization';

/**
 * Desktop-first primary navigation.
 *
 * A persistent grouped sidebar — never a bottom tab bar (ADR-016). On narrow
 * viewports it collapses to an off-canvas drawer, because this is a professional
 * tool used at a desk, not a phone app.
 */
export function Sidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const { queues } = useAdminSession();
  // Live queue depths; zero (no badge) until the first dashboard load lands.
  const badgeCounts: Record<string, number> = {
    reports: queues?.reports ?? 0,
    verification: queues?.verification ?? 0,
    support: queues?.support ?? 0,
    campaigns: queues?.campaigns ?? 0,
    coinRequests: queues?.coinRequests ?? 0,
    withdrawals: queues?.withdrawals ?? 0,
  };

  return (
    <>
      {/* Scrim for the drawer state */}
      {mobileOpen ? (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          aria-hidden
        />
      ) : null}

      <aside
        className={`
          fixed lg:sticky top-0 z-50 lg:z-auto h-screen shrink-0
          bg-panel border-r border-border flex flex-col
          transition-[width,transform] duration-200
          ${collapsed ? 'lg:w-[64px]' : 'lg:w-[236px]'}
          w-[236px]
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-3 border-b border-border shrink-0">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-accent flex items-center justify-center text-white font-bold text-sm shrink-0">
            V
          </span>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">Vyra</div>
              <div className="text-[10px] text-dim leading-tight">Super Admin</div>
            </div>
          ) : null}
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1 text-dim hover:text-ink"
            aria-label="Close navigation"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Groups */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-4">
          {navigation.map((group) => (
            <div key={group.title}>
              {!collapsed ? (
                <div className="px-2 mb-1 text-[10px] uppercase tracking-wider text-dim font-medium">
                  {group.title}
                </div>
              ) : (
                <div className="mx-2 mb-1.5 border-t border-border" />
              )}

              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  const badge = item.badge ? badgeCounts[item.badge] : undefined;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        title={collapsed ? item.label : undefined}
                        className={`
                          group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs
                          transition-colors
                          ${
                            active
                              ? 'bg-brand/15 text-brand font-medium'
                              : 'text-muted hover:text-ink hover:bg-surface-2'
                          }
                          ${collapsed ? 'justify-center' : ''}
                        `}
                      >
                        {active ? (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r bg-brand" />
                        ) : null}

                        <Icon name={item.icon as IconName} size={15} className="shrink-0" />

                        {!collapsed ? (
                          <>
                            <span className="truncate flex-1">{item.label}</span>
                            {badge ? (
                              <span className="tnum text-[10px] px-1.5 py-0.5 rounded bg-danger/20 text-danger font-medium">
                                {badge}
                              </span>
                            ) : null}
                          </>
                        ) : badge ? (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Collapse control — desktop only */}
        <div className="border-t border-border p-2 shrink-0 hidden lg:block">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-dim hover:text-ink hover:bg-surface-2 transition-colors ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={15} />
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        </div>
      </aside>
    </>
  );
}
