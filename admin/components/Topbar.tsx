'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { allNavItems, roleLabels, AdminRole } from '@/lib/nav';
import { useAdminSession } from '@/lib/session';

/**
 * Desktop top bar: breadcrumb, global search with keyboard hint, environment
 * badge, health indicator, notifications and the acting-admin menu.
 * None of this exists on mobile — the phone app uses a bottom tab bar (ADR-016).
 */
export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  const { identity, queues, signOut } = useAdminSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const current = allNavItems.find((item) => item.href === pathname);
  const role = (identity?.role ?? 'super_admin') as AdminRole;
  const initials = (identity?.name ?? 'A')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const attention =
    (queues?.reports ?? 0) + (queues?.verification ?? 0) + (queues?.campaigns ?? 0) +
    (queues?.coinRequests ?? 0) + (queues?.withdrawals ?? 0) + (queues?.support ?? 0);

  return (
    <header className="sticky top-0 z-30 h-14 bg-panel/95 backdrop-blur border-b border-border flex items-center gap-3 px-3 lg:px-4 shrink-0">
      {/* Drawer trigger — narrow viewports only */}
      <button
        onClick={onOpenNav}
        className="lg:hidden p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-2"
        aria-label="Open navigation"
      >
        <Icon name="menu" size={17} />
      </button>

      {/* Breadcrumb */}
      <nav className="hidden sm:flex items-center gap-1.5 text-xs shrink-0">
        <span className="text-dim">Admin</span>
        <Icon name="chevronRight" size={11} className="text-dim" />
        <span className="text-ink font-medium">{current?.label ?? 'Dashboard'}</span>
      </nav>

      {/* Global search */}
      <div className="flex-1 max-w-md ml-auto lg:ml-4">
        <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-2.5 h-8 focus-within:border-brand transition-colors">
          <Icon name="search" size={13} className="text-dim shrink-0" />
          <input
            placeholder="Search users, videos, campaigns, tickets…"
            className="bg-transparent outline-none text-xs w-full placeholder:text-dim"
          />
          <kbd className="hidden md:inline text-[10px] text-dim border border-border rounded px-1 py-0.5 shrink-0">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Environment */}
        <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md border border-warn/30 bg-warn/10 text-warn font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" />
          LOCAL
        </span>

        {/* Health */}
        <Link
          href="/health"
          title="System health"
          className="hidden sm:inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md border font-medium transition-colors border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
        >
          <Icon name="pulse" size={11} />
          Health
        </Link>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen((o) => !o);
              setMenuOpen(false);
            }}
            className="relative p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-2"
            aria-label="Notifications"
          >
            <Icon name="bell" size={16} />
            {attention > 0 ? (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger" />
            ) : null}
          </button>

          {notifOpen ? (
            <div className="absolute right-0 mt-2 w-72 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-xs font-semibold">
                Needs attention
              </div>
              <ul className="divide-y divide-border">
                {[
                  { href: '/moderation', label: 'Open reports', count: queues?.reports ?? 0, tone: 'text-danger' },
                  { href: '/verification', label: 'Verification requests', count: queues?.verification ?? 0, tone: 'text-warn' },
                  { href: '/ads', label: 'Campaigns awaiting review', count: queues?.campaigns ?? 0, tone: 'text-info' },
                  { href: '/coin-requests', label: 'Coin purchase requests', count: queues?.coinRequests ?? 0, tone: 'text-warn' },
                  { href: '/withdrawals', label: 'Withdrawal requests', count: queues?.withdrawals ?? 0, tone: 'text-warn' },
                  { href: '/support', label: 'Open tickets', count: queues?.support ?? 0, tone: 'text-info' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setNotifOpen(false)}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs hover:bg-surface-2"
                    >
                      <span className="text-muted">{item.label}</span>
                      <span className={`tnum font-semibold ${item.tone}`}>{item.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Acting admin */}
        <div className="relative">
          <button
            onClick={() => {
              setMenuOpen((o) => !o);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-brand to-accent flex items-center justify-center text-[10px] font-bold text-white">
              {initials}
            </span>
            <span className="hidden md:block text-left leading-tight">
              <span className="block text-[11px] text-ink">{identity?.name ?? 'Admin'}</span>
              <span className="block text-[10px] text-dim">{roleLabels[role] ?? role}</span>
            </span>
            <Icon name="chevronDown" size={12} className="text-dim hidden md:block" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 mt-2 w-60 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <div className="text-xs font-semibold">{identity?.name ?? 'Admin'}</div>
                <div className="text-[10px] text-dim mt-0.5">{roleLabels[role] ?? role}</div>
              </div>

              <ul className="py-1">
                {[
                  { href: '/security', label: 'Security settings', icon: 'lock' as const },
                  { href: '/audit', label: 'My audit trail', icon: 'list' as const },
                  { href: '/settings', label: 'App settings', icon: 'settings' as const },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs text-muted hover:text-ink hover:bg-surface-2"
                    >
                      <Icon name={item.icon} size={14} />
                      {item.label}
                    </Link>
                  </li>
                ))}
                <li className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={signOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-danger hover:bg-danger/10"
                  >
                    <Icon name="logout" size={14} />
                    Sign out
                  </button>
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
