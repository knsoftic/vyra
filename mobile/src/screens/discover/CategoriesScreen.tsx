import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Segmented,
  VideoTile,
  GRID_GAP,
  EmptyState,
  Button,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useGridTileWidth, useContentWidth } from '../../hooks/useResponsive';
import { useApiData } from '../../hooks/useApiData';
import { discover, toVideo } from '../../api';
import { categories, videosByCategory, nearbyVideos, videos } from '../../mock';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';


export function CategoriesScreen({ navigation }: RootScreenProps<'Categories'>) {
  const theme = useTheme();
  const cardWidth = (useContentWidth() - 16 * 2 - 12) / 2;

  // The category list is admin-editable, so it has to come from the server:
  // a hard-coded copy here would mean a category added in the admin panel never
  // appears in the app. Icon and colour travel with the row for the same reason.
  const { data: liveCategories, source } = useApiData(
    () => discover.categories(),
    [],
    [],
    { requiresAuth: false },
  );

  const list =
    source === 'live'
      ? liveCategories.map((c) => ({
          id: c.slug,
          name: c.name,
          icon: c.icon ?? 'grid-outline',
          color: c.color ?? theme.colors.brand,
          videoCount: c.videoCount,
        }))
      : categories;

  return (
    <Screen>
      <Header title="Categories" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: theme.spacing.md }}>
        <SourceNote
          source={source}
          noun="categories"
          liveHint="managed from the admin panel"
        />
        <View style={styles.grid}>
          {list.map((category) => (
            <Pressable
              key={category.id}
              onPress={() =>
                navigation.navigate('CategoryFeed', { categoryId: category.id, name: category.name })
              }
              style={[
                styles.card,
                {
                  width: cardWidth,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.lg,
                  padding: theme.spacing.md,
                },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: `${category.color}22` }]}>
                <Ionicons name={category.icon as never} size={22} color={category.color} />
              </View>
              <Text variant="bodyStrong" numberOfLines={1} style={{ marginTop: theme.spacing.xs }}>
                {category.name}
              </Text>
              <Text variant="caption" tone="muted">
                {formatCount(category.videoCount)} videos
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

export function CategoryFeedScreen({ navigation, route }: RootScreenProps<'CategoryFeed'>) {
  const theme = useTheme();
  const gridTile = useGridTileWidth(3, GRID_GAP);
  const { categoryId, name } = route.params;
  const [sort, setSort] = useState<'popular' | 'recent' | 'nearby'>('popular');

  const [locationGranted, setLocationGranted] = useState(false);

  const sampleList =
    sort === 'recent' ? [...videosByCategory(name)].reverse() : videosByCategory(name);
  const sampleFallback = sampleList.length === 0 ? videos.slice(0, 6) : sampleList;

  // `categoryId` is the slug when the list came from the server. Nearby has no
  // backend at all, so it is never asked for.
  const { data: liveVideos, source } = useApiData(
    () =>
      discover
        .categoryVideos(categoryId, sort === 'recent' ? 'recent' : 'popular')
        .then((rows) => rows.map((v) => toVideo(v))),
    sampleFallback,
    [categoryId, sort],
    { requiresAuth: false, enabled: sort !== 'nearby' },
  );

  const list =
    sort === 'nearby'
      ? locationGranted
        ? nearbyVideos
        : []
      : source === 'live'
        ? liveVideos
        : sampleFallback;

  const fallback = list;

  return (
    <Screen>
      <Header title={name} />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'popular', label: 'Popular' },
            { id: 'recent', label: 'Recent' },
            { id: 'nearby', label: 'Nearby' },
          ]}
          value={sort}
          onChange={setSort}
        />
      </View>

      {sort === 'nearby' && !locationGranted ? (
        <View style={{ paddingTop: theme.spacing.xxl }}>
          <EmptyState
            icon="location-outline"
            title="Nearby needs location access"
            description="Turn on location to see videos posted around you. Nothing is shared with other users and you can switch it off at any time."
          />
          <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.md }}>
            <Button
              label="Allow location"
              variant="gradient"
              fullWidth
              onPress={() => setLocationGranted(true)}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={fallback}
          keyExtractor={(item) => item.id}
          numColumns={3}
          ListHeaderComponent={
            sort === 'nearby' ? null : (
              <SourceNote source={source} noun={`${name} videos`} />
            )
          }
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <VideoTile
              video={item}
              width={gridTile}
              onPress={() => navigation.navigate('VideoPlayer', { videoId: item.id })}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="videocam-outline" title="No videos in this category yet" />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {},
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
