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
      deletable
      createLabel="Add track"
      createFields={[
        { column: 'public_id', label: 'Track ID', kind: 'string', required: true, placeholder: 'trk_summer_2026', help: 'unique, your own reference' },
        { column: 'title', label: 'Title', kind: 'string', required: true },
        { column: 'artist', label: 'Artist', kind: 'string', required: true },
        { column: 'audio_url', label: 'Audio URL', kind: 'string', required: true, placeholder: 'https://…/track.mp3', help: 'the hosted file the app streams' },
        { column: 'duration_sec', label: 'Duration (seconds)', kind: 'number', required: true, placeholder: '30' },
        { column: 'cover_url', label: 'Cover URL', kind: 'string' },
        { column: 'category', label: 'Category', kind: 'string', placeholder: 'pop' },
        { column: 'licence_status', label: 'Licence', kind: 'string', placeholder: 'licensed', help: 'licensed, owned, disputed, expired' },
        { column: 'is_enabled', label: 'Enabled', kind: 'boolean' },
      ]}
    />
  );
}
