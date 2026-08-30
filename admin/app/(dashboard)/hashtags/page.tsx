'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function HashtagsPage() {
  return (
    <CataloguePage
      title="Hashtags"
      subtitle="Most used first. Blocking a tag stops it trending and being suggested; nothing already posted is deleted."
      path="hashtags"
      cardDescription="status accepts: normal, official, sponsored, restricted, blocked."
      columns={[
        { key: 'tag', label: 'Tag', kind: 'readonly' },
        { key: 'videos', label: 'Videos', kind: 'readonly', align: 'right' },
        { key: 'views', label: 'Views', kind: 'readonly', align: 'right' },
        { key: 'status', label: 'Status', kind: 'text', writeAs: 'status' },
        { key: 'isFeatured', label: 'Featured', kind: 'toggle', writeAs: 'is_featured', align: 'center' },
      ]}
    />
  );
}
