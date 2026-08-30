import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Button,
  Avatar,
  VideoTile,
  GRID_GAP,
  Badge,
  IconButton,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useGridTileWidth } from '../../hooks/useResponsive';
import { useApiData } from '../../hooks/useApiData';
import { discover, toVideo } from '../../api';
import { videos, trendingHashtags, musicLibrary } from '../../mock';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function HashtagScreen({ navigation, route }: RootScreenProps<'Hashtag'>) {
  const theme = useTheme();
  const gridTile = useGridTileWidth(3, GRID_GAP);
  const { tag } = route.params;

  const meta = trendingHashtags.find((h) => h.tag === tag);
  const tagged = videos.filter((v) => v.hashtags.includes(tag));
  const sampleList = tagged.length > 0 ? tagged : videos.slice(0, 9);

  const { data: list, source } = useApiData(
    () => discover.hashtagVideos(tag).then((rows) => rows.map((v) => toVideo(v))),
    sampleList,
    [tag],
    { requiresAuth: false },
  );

  // The live hashtag row carries its own counts; the sample table is only
  // consulted when there is no server behind the screen.
  const { data: liveTags } = useApiData(() => discover.hashtags(), [], [], {
    requiresAuth: false,
  });
  const liveMeta = liveTags.find((h) => h.tag === tag.replace(/^#/, '').toLowerCase());
  const viewCount = liveMeta ? liveMeta.viewCount : (meta?.views ?? 0);

  return (
    <Screen>
      <Header
        title={`#${tag}`}
        right={<IconButton icon="share-social-outline" size={20} />}
      />

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ gap: GRID_GAP }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ padding: theme.spacing.md }}>
            <View style={styles.header}>
              <View style={[styles.tagIcon, { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg }]}>
                <Ionicons name="pricetag" size={26} color={theme.colors.text} />
              </View>
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text variant="h2" numberOfLines={1}>
                    #{tag}
                  </Text>
                  {meta?.isOfficial ? <Badge label="Official" tone="accent" size="sm" /> : null}
                  {meta?.isSponsored ? <Badge label="Sponsored" tone="gold" size="sm" /> : null}
                </View>
                <Text variant="label" tone="secondary">
                  {formatCount(viewCount)} views
                  {liveMeta ? ` · ${formatCount(liveMeta.videoCount)} videos` : ''}
                </Text>
                <SourceNote source={source} noun="videos" />
              </View>
            </View>

            <View style={[styles.actions, { marginTop: theme.spacing.md }]}>
              <Button label="Add to Favourites" variant="secondary" icon="bookmark-outline" style={styles.flex} />
              <Button
                label="Create"
                variant="gradient"
                icon="add"
                onPress={() => navigation.navigate('Record')}
                style={styles.flex}
              />
            </View>

            <Text variant="labelStrong" tone="muted" style={{ marginTop: theme.spacing.lg }}>
              TOP VIDEOS
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <VideoTile
            video={item}
            width={gridTile}
            onPress={() => navigation.navigate('VideoPlayer', { videoId: item.id })}
          />
        )}
      />
    </Screen>
  );
}

export function SoundDetailScreen({ navigation, route }: RootScreenProps<'SoundDetail'>) {
  const theme = useTheme();
  const gridTile = useGridTileWidth(3, GRID_GAP);
  const { soundId } = route.params;

  const sound = musicLibrary.find((s) => s.id === soundId) ?? musicLibrary[0];
  const usedIn = videos.filter((v) => v.sound.id === sound.id);
  const list = usedIn.length > 0 ? usedIn : videos.slice(0, 6);

  return (
    <Screen>
      <Header title="Sound" right={<IconButton icon="share-social-outline" size={20} />} />

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ gap: GRID_GAP }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ padding: theme.spacing.md }}>
            <View style={styles.header}>
              <Image
                source={{ uri: sound.cover }}
                style={[styles.cover, { borderRadius: theme.radius.md }]}
                contentFit="cover"
              />
              <View style={styles.flex}>
                <Text variant="h3" numberOfLines={2}>
                  {sound.title}
                </Text>
                <Text variant="label" tone="secondary">
                  {sound.artist}
                </Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {formatCount(sound.usageCount ?? 0)} videos
                </Text>
                {sound.isOriginal ? (
                  <Badge label="Original sound" tone="brand" size="sm" style={{ marginTop: 6 }} />
                ) : null}
              </View>
            </View>

            <View style={[styles.actions, { marginTop: theme.spacing.md }]}>
              <Button
                label={sound.isFavorite ? 'In Favourites' : 'Add to Favourites'}
                variant="secondary"
                icon="bookmark-outline"
                style={styles.flex}
              />
              <Button
                label="Use this sound"
                variant="gradient"
                icon="musical-notes"
                onPress={() => navigation.navigate('Record')}
                style={styles.flex}
              />
            </View>

            <Text variant="labelStrong" tone="muted" style={{ marginTop: theme.spacing.lg }}>
              VIDEOS USING THIS SOUND
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <VideoTile
            video={item}
            width={gridTile}
            onPress={() => navigation.navigate('VideoPlayer', { videoId: item.id })}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  tagIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  cover: { width: 72, height: 72 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
});
