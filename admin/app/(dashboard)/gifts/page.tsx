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
    />
  );
}
