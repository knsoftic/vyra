import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, FlatList, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Text,
  Pressable,
  Avatar,
  NameWithBadge,
  Button,
  Chip,
  TopTabs,
  VideoTile,
  GRID_GAP,
  ListRow,
  EmptyState,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useGridTileWidth } from '../../hooks/useResponsive';
import { useSearch } from '../../hooks/useSearch';
import { useApiData } from '../../hooks/useApiData';
import { discover, users as usersApi, toVideo, fallbackAvatar } from '../../api';
import { users, videos, musicLibrary, trendingHashtags, recentSearches, suggestedSearches } from '../../mock';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';
import type { User } from '../../types';

type SearchTab = 'top' | 'users' | 'videos' | 'sounds' | 'hashtags';

export function SearchScreen({ navigation }: RootScreenProps<'Search'>) {
  const theme = useTheme();
  const gridTile = useGridTileWidth(3, GRID_GAP);
  const { isFollowing, toggleFollow } = useApp();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('top');
  const [history, setHistory] = useState(recentSearches);

  const searching = query.trim().length > 0;
  const needle = query.trim().toLowerCase();

  // Debounced and ordered; falls back to null whenever there is no backend.
  const { results: live, sounds: liveSounds, loading: searchLoading } = useSearch(query);

  // Trending hashtags on the idle screen are real when the server is reachable.
  const { data: liveTrending, source: trendingSource } = useApiData(
    () => discover.hashtags(),
    [],
    [],
    { requiresAuth: false },
  );

  const sampleResults = useMemo(() => {
    if (!searching) return { users: [], videos: [], sounds: [], hashtags: [] };
    return {
      users: users.filter(
        (u) =>
          u.username.toLowerCase().includes(needle) ||
          u.displayName.toLowerCase().includes(needle),
      ),
      videos: videos.filter(
        (v) =>
          v.caption.toLowerCase().includes(needle) ||
          v.hashtags.some((h) => h.includes(needle)) ||
          v.category.toLowerCase().includes(needle),
      ),
      sounds: musicLibrary.filter(
        (s) =>
          s.title.toLowerCase().includes(needle) || s.artist.toLowerCase().includes(needle),
      ),
      hashtags: trendingHashtags.filter((h) => h.tag.includes(needle)),
    };
  }, [needle, searching]);

  // One shape either way, so the rendering below does not branch on the source.
  const results = live
    ? {
        users: live.users.map<User>((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar ?? fallbackAvatar(u.username),
          accountCategory: 'individual' as const,
          accountType: 'normal' as const,
          verification: u.verificationTier as User['verification'],
          followers: u.followers,
          following: 0,
          likes: 0,
          videos: 0,
          isFollowing: u.isFollowing,
          // Carried through so the row can hide its own follow button.
          isSelf: u.isSelf,
        })),
        videos: live.videos.map((v) => toVideo(v)),
        sounds: liveSounds.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          cover: t.coverUrl ?? '',
          durationSec: t.durationSec,
          usageCount: t.usageCount,
        })),
        hashtags: live.hashtags.map((h) => ({
          id: h.tag,
          tag: h.tag,
          views: h.viewCount,
        })),
      }
    : sampleResults;

  const resultSource = live ? 'live' : 'sample';

  const trending = trendingSource === 'live'
    ? liveTrending.map((h) => ({ id: h.tag, tag: h.tag, views: h.viewCount }))
    : trendingHashtags.slice(0, 6).map((h) => ({ id: h.id, tag: h.tag, views: h.views }));

  const renderUserRow = (user: User & { isSelf?: boolean }) => {
    const following = live ? (user.isFollowing ?? false) : isFollowing(user);
    return (
      <ListRow
        key={user.id}
        label={user.displayName}
        description={`@${user.username} · ${formatCount(user.followers)} followers`}
        onPress={() => navigation.navigate('Profile', { userId: user.id })}
        showChevron={false}
        left={<Avatar uri={user.avatar} size={44} live={user.isLive} />}
        right={
          user.isSelf ? (
            <Text variant="caption" tone="muted">
              You
            </Text>
          ) : (
          <Button
            label={following ? 'Following' : 'Follow'}
            variant={following ? 'secondary' : 'primary'}
            size="sm"
            onPress={() => {
              // A live result is a real account, so the follow is a real write.
              if (live) {
                void (following ? usersApi.unfollow(user.id) : usersApi.follow(user.id)).catch(
                  () => undefined,
                );
                return;
              }
              toggleFollow(user.id);
            }}
          />
          )
        }
      />
    );
  };

  return (
    <Screen>
      {/* Search bar */}
      <View style={[styles.searchRow, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="chevron-back" size={26} color={theme.colors.text} />
        </Pressable>

        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="search" size={17} color={theme.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.colors.textMuted}
            autoFocus
            returnKeyType="search"
            style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={theme.layout.hitSlop}>
              <Ionicons name="close-circle" size={17} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!searching ? (
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {history.length > 0 ? (
            <>
              <View style={[styles.sectionRow, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }]}>
                <Text variant="bodyStrong">Recent</Text>
                <Pressable onPress={() => setHistory([])}>
                  <Text variant="label" tone="brand">
                    Clear
                  </Text>
                </Pressable>
              </View>
              {history.map((item) => (
                <ListRow
                  key={item}
                  label={item}
                  icon="time-outline"
                  onPress={() => setQuery(item)}
                  showChevron={false}
                  right={
                    <Pressable
                      onPress={() => setHistory((h) => h.filter((x) => x !== item))}
                      hitSlop={theme.layout.hitSlop}
                    >
                      <Ionicons name="close" size={16} color={theme.colors.textMuted} />
                    </Pressable>
                  }
                />
              ))}
            </>
          ) : null}

          <Text
            variant="bodyStrong"
            style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
          >
            You might like
          </Text>
          <View style={[styles.suggestWrap, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm }]}>
            {suggestedSearches.map((suggestion) => (
              <Chip key={suggestion} label={suggestion} onPress={() => setQuery(suggestion)} />
            ))}
          </View>

          <Text
            variant="bodyStrong"
            style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xl }}
          >
            Trending searches
          </Text>
          {trending.slice(0, 6).map((hashtag) => (
            <ListRow
              key={hashtag.id}
              label={`#${hashtag.tag}`}
              description={`${formatCount(hashtag.views)} views`}
              icon="trending-up"
              iconColor={theme.colors.brand}
              onPress={() => navigation.navigate('Hashtag', { tag: hashtag.tag })}
            />
          ))}
        </ScrollView>
      ) : (
        <>
          <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TopTabs
                tabs={[
                  { id: 'top', label: 'Top' },
                  { id: 'users', label: 'Users' },
                  { id: 'videos', label: 'Videos' },
                  { id: 'sounds', label: 'Sounds' },
                  { id: 'hashtags', label: 'Hashtags' },
                ]}
                value={tab}
                onChange={setTab}
              />
            </ScrollView>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <SourceNote
              source={resultSource}
              noun="results"
              sampleHint="matched against the sample catalogue on this device"
              liveHint={searchLoading ? 'searching…' : 'matched on the server'}
            />

            {(tab === 'top' || tab === 'users') && results.users.length > 0 ? (
              <>
                {tab === 'top' ? (
                  <Text variant="labelStrong" tone="muted" style={styles.groupLabel}>
                    ACCOUNTS
                  </Text>
                ) : null}
                {results.users.slice(0, tab === 'top' ? 3 : undefined).map((u) => renderUserRow(u))}
              </>
            ) : null}

            {(tab === 'top' || tab === 'hashtags') && results.hashtags.length > 0 ? (
              <>
                {tab === 'top' ? (
                  <Text variant="labelStrong" tone="muted" style={styles.groupLabel}>
                    HASHTAGS
                  </Text>
                ) : null}
                {results.hashtags.map((hashtag) => (
                  <ListRow
                    key={hashtag.id}
                    label={`#${hashtag.tag}`}
                    description={`${formatCount(hashtag.views)} views`}
                    icon="pricetag-outline"
                    onPress={() => navigation.navigate('Hashtag', { tag: hashtag.tag })}
                  />
                ))}
              </>
            ) : null}

            {(tab === 'top' || tab === 'sounds') && results.sounds.length > 0 ? (
              <>
                {tab === 'top' ? (
                  <Text variant="labelStrong" tone="muted" style={styles.groupLabel}>
                    SOUNDS
                  </Text>
                ) : null}
                {results.sounds.slice(0, tab === 'top' ? 3 : undefined).map((sound) => (
                  <ListRow
                    key={sound.id}
                    label={sound.title}
                    description={`${sound.artist} · ${formatCount(sound.usageCount ?? 0)} videos`}
                    left={<Avatar uri={sound.cover} size={44} />}
                    onPress={() => navigation.navigate('SoundDetail', { soundId: sound.id })}
                  />
                ))}
              </>
            ) : null}

            {(tab === 'top' || tab === 'videos') && results.videos.length > 0 ? (
              <>
                {tab === 'top' ? (
                  <Text variant="labelStrong" tone="muted" style={styles.groupLabel}>
                    VIDEOS
                  </Text>
                ) : null}
                <FlatList
                  data={results.videos}
                  keyExtractor={(item) => item.id}
                  numColumns={3}
                  scrollEnabled={false}
                  columnWrapperStyle={{ gap: GRID_GAP }}
                  contentContainerStyle={{ gap: GRID_GAP }}
                  renderItem={({ item }) => (
                    <VideoTile
                      video={item}
                      width={gridTile}
                      onPress={() => navigation.navigate('VideoPlayer', { videoId: item.id })}
                    />
                  )}
                />
              </>
            ) : null}

            {results.users.length === 0 &&
            results.videos.length === 0 &&
            results.sounds.length === 0 &&
            results.hashtags.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title="No results"
                description={`Nothing matched "${query}". Try a different spelling or a broader term.`}
              />
            ) : null}
          </ScrollView>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suggestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groupLabel: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, letterSpacing: 0.8 },
});
