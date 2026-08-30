'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function FlagsPage() {
  return (
    <CataloguePage
      title="Feature Flags"
      subtitle="Rollout switches. A flag at 50% holds for half of users, decided per account, not per request."
      path="flags"
      columns={[
        { key: 'flagKey', label: 'Key', kind: 'readonly' },
        { key: 'label', label: 'Label', kind: 'text', writeAs: 'label' },
        { key: 'description', label: 'Description', kind: 'text', writeAs: 'description' },
        { key: 'rolloutPercent', label: 'Rollout %', kind: 'number', writeAs: 'rollout_percent', align: 'right' },
        { key: 'isEnabled', label: 'On', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
