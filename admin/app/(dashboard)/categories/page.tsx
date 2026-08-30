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
      createLabel="Add category"
      createFields={[
        { column: 'slug', label: 'Slug', kind: 'string', required: true, placeholder: 'comedy', help: 'lowercase, no spaces' },
        { column: 'name', label: 'Name', kind: 'string', required: true, placeholder: 'Comedy' },
        { column: 'icon', label: 'Icon', kind: 'string', placeholder: 'happy-outline' },
        { column: 'color', label: 'Colour', kind: 'string', placeholder: '#6D5AE6' },
        { column: 'sort_order', label: 'Order', kind: 'number', placeholder: '10' },
        { column: 'is_enabled', label: 'Enabled', kind: 'boolean' },
      ]}
    />
  );
}
