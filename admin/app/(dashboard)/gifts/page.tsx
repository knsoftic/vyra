'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function GiftsPage() {
  return (
    <CataloguePage
      title="Gifts"
      subtitle="The live-stream gift catalogue. Changing a price affects new gifts only — every past transaction keeps the price it was bought at."
      path="gift-catalogue"
      columns={[
        { key: 'icon', label: 'Icon', kind: 'text', writeAs: 'icon' },
        { key: 'name', label: 'Name', kind: 'text', writeAs: 'name' },
        { key: 'coins', label: 'Coins', kind: 'number', writeAs: 'coins', align: 'right' },
        { key: 'timesSent', label: 'Times sent', kind: 'readonly', align: 'right' },
        { key: 'isFeatured', label: 'Featured', kind: 'toggle', writeAs: 'is_featured', align: 'center' },
        { key: 'isActive', label: 'Active', kind: 'toggle', writeAs: 'is_active', align: 'center' },
      ]}
      createLabel="Add gift"
      createFields={[
        { column: 'slug', label: 'Slug', kind: 'string', required: true, placeholder: 'rose' },
        { column: 'name', label: 'Name', kind: 'string', required: true, placeholder: 'Rose' },
        { column: 'icon', label: 'Icon', kind: 'string', required: true, placeholder: '🌹', help: 'an emoji' },
        { column: 'coins', label: 'Coins', kind: 'number', required: true, placeholder: '10' },
        { column: 'sort_order', label: 'Order', kind: 'number' },
        { column: 'is_featured', label: 'Featured', kind: 'boolean' },
        { column: 'is_active', label: 'Active', kind: 'boolean' },
      ]}
    />
  );
}
