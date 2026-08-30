'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function MusicPage() {
  return (
    <CataloguePage
      title="Music & Audio"
      subtitle="The licensed library. Disabling a track removes it from the picker; videos already using it keep playing."
      path="music"
      columns={[
        { key: 'title', label: 'Title', kind: 'readonly' },
        { key: 'artist', label: 'Artist', kind: 'readonly' },
        { key: 'category', label: 'Category', kind: 'text', writeAs: 'category' },
        { key: 'uses', label: 'Uses', kind: 'readonly', align: 'right' },
        { key: 'licence', label: 'Licence', kind: 'badge' },
        { key: 'isTrending', label: 'Trending', kind: 'toggle', writeAs: 'is_trending', align: 'center' },
        { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
