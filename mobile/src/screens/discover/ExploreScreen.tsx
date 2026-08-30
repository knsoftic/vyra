import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Text,
  Pressable,
  Avatar,
  NameWithBadge,
  Button,
  SectionTitle,
  MediaCard,
  VideoTile,
  GRID_GAP,
} from '../../components';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useGridTileWidth } from '../../hooks/useResponsive';
import { useApiData } from '../../hooks/useApiData';
import { discover, users as usersApi, toVideo, fallbackAvatar } from '../../api';
import {
  categories,
  trendingHashtags,
  featuredCreators,
  exploreBanners,
  liveStreams,
  trendingVideos,
} from '../../mock';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { TabScreenProps } from '../../navigation/types';
import type { User } from '../../types';

export function ExploreScreen({ navigation }: TabScreenProps<'Explore'>) {
  const theme = useTheme();
  const gridTile = useGridTileWidth(3, GRID_GAP);
  const { isFollowing, toggleFollow } = useApp();

  // Explore is a mixture: some sections have a backend, some do not yet.
  // Each one carries its own label so the difference is visible rather than
  // averaged into a single claim about the whole screen.
  const { data: liveCategories, source: categorySource } = useApiData(
    () => discover.categories(),
    [],
    [],
    { requiresAuth: false },
  );

  const { data: liveHashtags, source: hashtagSource } = useApiData(
    () => discover.hashtags(),
    [],
    [],
    { requiresAuth: false },
  );

  const { data: liveCreators, source: creatorSource, refresh: refreshCreators } = useApiData(
    () => discover.creators(),
    [],
    [],
    { requiresAuth: false },
  );

  const { data: liveTrending, source: trendingSource } = useApiData(
    () => discover.trending(12).then((rows) => rows.map((v) => toVideo(v))),
    trendingVideos.slice(0, 9),
    [],
    { requiresAuth: false },
  );

  // Follows written optimistically here would disagree with the server on the
  // next load, so the row is re-read instead.
  const [pendingFollow, setPendingFollow] = useState<string | null>(null);

  const categoryList =
    categorySource === 'live'
      ? liveCategories.slice(0, 8).map((c) => ({
          id: c.slug,
          name: c.name,
          icon: c.icon ?? 'grid-outline',
          color: c.color ?? theme.colors.brand,
          videoCount: c.videoCount,
        }))
      : categories.slice(0, 8);

  const hashtagList =
    hashtagSource === 'live'
      ? liveHashtags.slice(0, 5).map((h) => ({
          id: h.tag,
          tag: h.tag,
          views: h.viewCount,
          isOfficial: false,
          isSponsored: false,
        }))
      : trendingHashtags.slice(0, 5);

  const creatorList: User[] =
    creatorSource === 'live'
      ? liveCreators.map((c) => ({
          id: c.id,
          username: c.username,
          displayName: c.displayName,
          avatar: c.avatar ?? fallbackAvatar(c.username),
          bio: c.bio,
          accountCategory: 'individual',
          accountType: 'normal',
          verification: c.verificationTier as User['verification'],
          followers: c.followers,
          // Not returned by this endpoint, and not shown on the card either.
          following: 0,
          likes: 0,
          videos: c.videos,
          isFollowing: c.isFollowing,
        }))
      : featuredCreators;

  const onFollowCreator = async (creatorId: string, following: boolean) => {
    if (creatorSource !== 'live') {
      toggleFollow(creatorId);
      return;
    }
    setPendingFollow(creatorId);
    try {
      await (following ? usersApi.unfollow(creatorId) : usersApi.follow(creatorId));
      await refreshCreators();
    } catch {
      // The list is re-read on the next visit; nothing is faked in the meantime.
    } finally {
      setPendingFollow(null);
    }
  };

  return (
    <Screen>
      {/* Search entry */}
      <View style={[styles.searchRow, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs }]}>
        <Pressable
          onPress={() => navigation.navigate('Search')}
          style={[
            styles.searchBar,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="search" size={17} color={theme.colors.textMuted} />
          <Text variant="body" tone="muted">
            Search creators, videos, sounds
          </Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('LiveList')} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="radio-outline" size={24} color={theme.colors.text} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Banners */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm, paddingTop: theme.spacing.xs }}
        >
          {exploreBanners.map((banner) => (
            <Pressable
              key={banner.id}
              style={[styles.banner, { borderRadius: theme.radius.lg }]}
            >
              <Image source={{ uri: banner.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient
                colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.85)']}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.bannerContent}>
                <Text variant="h3" tone="onDark">
                  {banner.title}
                </Text>
                <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }} numberOfLines={1}>
                  {banner.subtitle}
                </Text>
                <View style={[styles.bannerCta, { backgroundColor: theme.colors.brand }]}>
                  <Text variant="caption" tone="onDark">
                    {banner.cta}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Categories */}
        <SectionTitle title="Categories" action="See all" onActionPress={() => navigation.navigate('Categories')} />
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
          <SourceTag source={categorySource} noun="categories" />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.xs }}
        >
          {categoryList.map((category) => (
            <Pressable
              key={category.id}
              onPress={() =>
                navigation.navigate('CategoryFeed', { categoryId: category.id, name: category.name })
              }
              style={[
                styles.category,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
              ]}
            >
              <View style={[styles.categoryIcon, { backgroundColor: `${category.color}22` }]}>
                <Ionicons name={category.icon as never} size={20} color={category.color} />
              </View>
              <Text variant="label" numberOfLines={1}>
                {category.name}
              </Text>
              <Text variant="caption" tone="muted">
                {formatCount(category.videoCount)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Live now */}
        <SectionTitle title="Live now" action="See all" onActionPress={() => navigation.navigate('LiveList')} />
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
          <SourceTag source="sample" noun="streams" detail="live streaming is not built yet" />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm }}
        >
          {liveStreams.slice(0, 5).map((stream) => (
            <MediaCard
              key={stream.id}
              image={stream.thumbnail}
              title={stream.title}
              subtitle={`@${stream.host.username}`}
              overlay={formatCount(stream.viewers)}
              live
              width={128}
              aspect={1.45}
              onPress={() => navigation.navigate('LiveViewer', { streamId: stream.id })}
            />
          ))}
        </ScrollView>

        {/* Trending hashtags */}
        <SectionTitle title="Trending hashtags" />
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
          <SourceTag source={hashtagSource} noun="hashtags" />
        </View>
        <View style={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.xs }}>
          {hashtagList.map((hashtag, index) => (
            <Pressable
              key={hashtag.id}
              onPress={() => navigation.navigate('Hashtag', { tag: hashtag.tag })}
              style={[
                styles.hashtagRow,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.sm },
              ]}
            >
              <Text variant="h3" tone="muted" style={styles.rank}>
                {index + 1}
              </Text>
              <View style={styles.flex}>
                <View style={styles.hashtagTitle}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    #{hashtag.tag}
                  </Text>
                  {hashtag.isOfficial ? (
                    <Ionicons name="shield-checkmark" size={13} color={theme.colors.accent} />
                  ) : null}
                  {hashtag.isSponsored ? (
                    <Text variant="caption" tone="muted">
                      Sponsored
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" tone="muted">
                  {formatCount(hashtag.views)} views
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Featured creators */}
        <SectionTitle title="Creators to watch" />
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
          <SourceTag source={creatorSource} noun="creators" detail="ranked by real follower counts" />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm }}
        >
          {creatorList.map((creator) => {
            const following =
              creatorSource === 'live' ? (creator.isFollowing ?? false) : isFollowing(creator);
            return (
              <View
                key={creator.id}
                style={[
                  styles.creatorCard,
                  { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.md },
                ]}
              >
                <Pressable onPress={() => navigation.navigate('Profile', { userId: creator.id })}>
                  <Avatar uri={creator.avatar} size={56} live={creator.isLive} />
                </Pressable>
                <NameWithBadge
                  name={creator.displayName}
                  tier={creator.verification}
                  variant="labelStrong"
                />
                <Text variant="caption" tone="muted">
                  {formatCount(creator.followers)} followers
                </Text>
                <Button
                  label={following ? 'Following' : 'Follow'}
                  variant={following ? 'secondary' : 'primary'}
                  size="sm"
                  fullWidth
                  loading={pendingFollow === creator.id}
                  onPress={() => void onFollowCreator(creator.id, following)}
                  style={{ marginTop: theme.spacing.xs }}
                />
              </View>
            );
          })}
        </ScrollView>

        {/* Trending videos grid */}
        <SectionTitle title="Trending now" />
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
          <SourceTag source={trendingSource} noun="videos" detail="ordered by measured views" />
        </View>
        <FlatList
          data={liveTrending.slice(0, 9)}
          keyExtractor={(item) => item.id}
          numColumns={3}
          scrollEnabled={false}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingHorizontal: 0 }}
          renderItem={({ item }) => (
            <VideoTile
              video={item}
              width={gridTile}
              onPress={() => navigation.navigate('VideoPlayer', { videoId: item.id })}
            />
          )}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12 },
  banner: { width: 280, height: 130, overflow: 'hidden' },
  bannerContent: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 2 },
  bannerCta: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 6 },
  category: { width: 104, padding: 12, gap: 4 },
  categoryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  hashtagRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 24, textAlign: 'center' },
  hashtagTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  creatorCard: { width: 150, alignItems: 'center', gap: 4 },
});
