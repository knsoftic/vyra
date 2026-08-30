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
      createLabel="Add criterion"
      createFields={[
        { column: 'criterion_key', label: 'Key', kind: 'string', required: true, placeholder: 'followers_1000' },
        { column: 'label', label: 'Label', kind: 'string', required: true, placeholder: '1,000 followers' },
        { column: 'metric', label: 'Metric', kind: 'string', required: true, placeholder: 'followers' },
        { column: 'required', label: 'Required', kind: 'number', required: true, placeholder: '1000' },
        { column: 'unit', label: 'Unit', kind: 'string', placeholder: 'followers' },
        { column: 'sort_order', label: 'Order', kind: 'number' },
        { column: 'is_enabled', label: 'Enforced', kind: 'boolean' },
      ]}
    />
  );
}
