'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function MonetizationPage() {
  return (
    <CataloguePage
      title="Criteria & Creators"
      subtitle="What an account must reach before monetization unlocks. Checked against measured numbers, never self-reported ones."
      path="criteria"
      columns={[
        { key: 'label', label: 'Criterion', kind: 'text', writeAs: 'label' },
        { key: 'metric', label: 'Metric', kind: 'readonly' },
        { key: 'required', label: 'Required', kind: 'number', writeAs: 'required', align: 'right' },
        { key: 'unit', label: 'Unit', kind: 'readonly' },
        { key: 'isEnabled', label: 'Enforced', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
