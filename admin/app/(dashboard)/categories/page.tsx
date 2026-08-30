'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function CategoriesPage() {
  return (
    <CataloguePage
      title="Categories"
      subtitle="The category list every upload picks from. Disabling one hides it from the picker; existing videos keep theirs."
      path="categories"
      columns={[
        { key: 'name', label: 'Name', kind: 'text', writeAs: 'name' },
        { key: 'slug', label: 'Slug', kind: 'readonly' },
        { key: 'icon', label: 'Icon', kind: 'text', writeAs: 'icon' },
        { key: 'videos', label: 'Videos', kind: 'readonly', align: 'right' },
        { key: 'sortOrder', label: 'Order', kind: 'number', writeAs: 'sort_order', align: 'right' },
        { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
