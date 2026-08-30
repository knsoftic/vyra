import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  Button,
  ChipRow,
  EmptyState,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useContentWidth } from '../../hooks/useResponsive';
import { useLiveList } from '../../hooks/useLive';
import { liveStreams as sampleStreams, liveCategories } from '../../mock';
import { formatCount, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const GAP = 10;

export function LiveListScreen({ navigation }: RootScreenProps<'LiveList'>) {
  const theme = useTheme();
  const TILE = (useContentWidth() - 16 * 2 - GAP) / 2;
  const [category, setCategory] = useState('all');

  const { streams, live, loading, refresh } = useLiveList();

  /**
   * A server stream as the tile expects it.
   *
   * `coinsEarned` is the stream's real gift total. Nothing here is invented: a
   * stream with no gifts shows zero rather than a plausible-looking number.
   */
  const liveList = streams.map((stream) => ({
    id: stream.id,
    host: {
      id: stream.host.id,
      username: stream.host.username,
      displayName: stream.host.displayName,
      avatar: stream.host.avatar ?? `https://i.pravatar.cc/150?u=${stream.host.username}`,
      accountCategory: stream.host.accountCategory,
      accountType: stream.host.accountType as (typeof sampleStreams)[number]['host']['accountType'],
      verification: stream.host.verificationTier,
      followers: stream.host.followers,
      following: stream.host.following,
      likes: stream.host.likes,
      videos: stream.host.videos,
    },
    title: stream.title,
    category: 'live',
    thumbnail: stream.cover ?? `https://picsum.photos/seed/${stream.id}/400/600`,
    viewers: stream.viewerCount,
    likes: stream.likeCount,
    coinsEarned: stream.giftCoins,
    startedAt: stream.startedAt ?? new Date().toISOString(),
    // Guest slots are modelled but co-hosting is not built, so the list is
    // empty rather than absent — the tile checks for guests either way.
    guests: [] as (typeof sampleStreams)[number]['host'][],
  }));

  const source = live ? liveList : sampleStreams;

  const list =
    category === 'all'
      ? source
      : source.filter((stream) => stream.category.toLowerCase() === category);

  return (
    <Screen>
      <Header
        title="Live"
        right={
          <Button
            label="Go Live"
            variant="gradient"
            size="sm"
            icon="radio-outline"
            onPress={() => navigation.navigate('LiveSetup')}
          />
        }
      />

      <SourceNote
        source={live ? 'live' : 'sample'}
        noun="streams"
        sampleHint="nobody is broadcasting right now"
      />

      <FlatList
        data={list}
        refreshing={loading}
        onRefresh={() => void refresh()}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ padding: theme.spacing.md, gap: GAP, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ marginHorizontal: -theme.spacing.md, paddingBottom: theme.spacing.md }}>
            <ChipRow
              items={[
                { id: 'all', label: 'All' },
                ...liveCategories.map((name) => ({ id: name.toLowerCase(), label: name })),
              ]}
              selectedId={category}
              onSelect={setCategory}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="radio-outline"
            title="No live streams here"
            description="Nobody is live in this category right now. Try another one."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('LiveViewer', { streamId: item.id })}
            style={{ width: TILE }}
          >
            <View style={[styles.thumb, { borderRadius: theme.radius.lg, height: TILE * 1.4 }]}>
              <Image source={{ uri: item.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient colors={[...theme.gradients.dark]} style={StyleSheet.absoluteFill} />

              <View style={[styles.liveTag, { backgroundColor: theme.colors.brand }]}>
                <View style={styles.dot} />
                <Text variant="caption" tone="onDark">
                  LIVE
                </Text>
              </View>

              <View style={styles.viewers}>
                <Ionicons name="eye" size={11} color="#FFF" />
                <Text variant="caption" tone="onDark">
                  {formatCount(item.viewers)}
                </Text>
              </View>

              <View style={styles.thumbFooter}>
                <Avatar uri={item.host.avatar} size={26} />
                <Text variant="caption" tone="onDark" numberOfLines={1} style={styles.flex}>
                  @{item.host.username}
                </Text>
              </View>

              {item.guests?.length ? (
                <View style={styles.guestTag}>
                  <Ionicons name="people" size={10} color="#FFF" />
                  <Text variant="caption" tone="onDark">
                    Guest
                  </Text>
                </View>
              ) : null}
            </View>

            <Text variant="label" numberOfLines={2} style={{ marginTop: theme.spacing.xs }}>
              {item.title}
            </Text>
            <Text variant="caption" tone="muted">
              {item.category} · started {timeAgo(item.startedAt)}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  thumb: { overflow: 'hidden', backgroundColor: '#1C1C1F' },
  liveTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFF' },
  viewers: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  thumbFooter: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guestTag: {
    position: 'absolute',
    bottom: 40,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
