'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { AdminSessionProvider } from '@/lib/session';
import { Topbar } from '@/components/Topbar';

/**
 * Desktop application frame: fixed sidebar + sticky top bar + scrolling content.
 * Deliberately a different layout system from the mobile app (ADR-016).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <AdminSessionProvider>
    <div className="flex min-h-screen bg-bg">
      <Sidebar mobileOpen={navOpen} onCloseMobile={() => setNavOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full">{children}</main>
      </div>
    </div>
    </AdminSessionProvider>
  );
}
