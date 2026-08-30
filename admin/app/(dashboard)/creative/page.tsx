'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function CreativePage() {
  return (
    <CataloguePage
      title="Filters & Effects"
      subtitle="The creative catalogue the editor shows: filters, effects, sticker packs, text styles, fonts and transitions."
      path="creative"
      columns={[
        { key: 'kind', label: 'Kind', kind: 'badge' },
        { key: 'name', label: 'Name', kind: 'readonly' },
        { key: 'category', label: 'Category', kind: 'readonly' },
        { key: 'uses', label: 'Uses', kind: 'readonly', align: 'right' },
        { key: 'sortOrder', label: 'Order', kind: 'number', writeAs: 'sort_order', align: 'right' },
        { key: 'isTrending', label: 'Trending', kind: 'toggle', writeAs: 'is_trending', align: 'center' },
        { key: 'isNew', label: 'New', kind: 'toggle', writeAs: 'is_new', align: 'center' },
        { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
