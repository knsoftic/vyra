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
      createLabel="Add task"
      createFields={[
        { column: 'task_key', label: 'Task key', kind: 'string', required: true, placeholder: 'watch_10' },
        { column: 'title', label: 'Title', kind: 'string', required: true, placeholder: 'Watch 10 videos' },
        { column: 'metric', label: 'Metric', kind: 'string', required: true, placeholder: 'videos_watched', help: 'what the server counts — must be a metric it measures' },
        { column: 'target', label: 'Target', kind: 'number', required: true, placeholder: '10' },
        { column: 'reward_coins', label: 'Reward (coins)', kind: 'number', required: true, placeholder: '20' },
        { column: 'description', label: 'Description', kind: 'string' },
        { column: 'icon', label: 'Icon', kind: 'string' },
        { column: 'sort_order', label: 'Order', kind: 'number' },
        { column: 'is_enabled', label: 'Enabled', kind: 'boolean' },
      ]}
    />
  );
}
