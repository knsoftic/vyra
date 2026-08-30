'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function TasksPage() {
  return (
    <CataloguePage
      title="Daily Tasks"
      subtitle="What the daily list asks for and what it pays. Progress is measured server-side — the app never reports its own numbers (ADR-035)."
      path="daily-tasks"
      columns={[
        { key: 'title', label: 'Task', kind: 'text', writeAs: 'title' },
        { key: 'metric', label: 'Metric', kind: 'readonly' },
        { key: 'target', label: 'Target', kind: 'number', writeAs: 'target', align: 'right' },
        { key: 'rewardCoins', label: 'Reward (coins)', kind: 'number', writeAs: 'reward_coins', align: 'right' },
        { key: 'sortOrder', label: 'Order', kind: 'number', writeAs: 'sort_order', align: 'right' },
        { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
