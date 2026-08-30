import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, FlatList, ScrollView, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  VerifiedBadge,
  Button,
  IconButton,
  VideoTile,
  GRID_GAP,
  EmptyState,
  Badge,
  TopTabs,
  Sheet,
  ListRow,
} from '../../components';
import { useTheme } from '../../theme';
import { useGridTileWidth } from '../../hooks/useResponsive';
import { getUser, videos, myVideos, likedVideos, savedVideos } from '../../mock';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import { useApiData } from '../../hooks/useApiData';
import { useEventQueue } from '../../hooks/useEventQueue';
import { videos as videosApi, users as usersApi, toUser, type VideoSummary } from '../../api';
import type { PublicUser } from '../../../../shared/contracts/user';
import type { User, Video } from '../../types';
import type { RootScreenProps, TabScreenProps } from '../../navigation/types';

type ProfileTab = 'videos' | 'liked' | 'saved' | 'private';

/**
 * Adapts a server video summary to the card shape the grid renders.
 *
 * A video still being processed has no playable URL; the poster stands in and
 * the card shows a still rather than a broken player.
 */
function toVideoCard(summary: VideoSummary, author: User): Video {
  return {
    id: summary.id,
    author,
    caption: summary.caption,
    hashtags: [],
    mentions: [],
    sound: {
      id: `sound_${summary.id}`,
      title: 'Original sound',
      artist: author.displayName,
      cover: summary.posterUrl ?? '',
      durationSec: summary.durationSec,
      isOriginal: true,
    },
    url: summary.hlsUrl ?? '',
    poster: summary.posterUrl ?? `https://picsum.photos/seed/${summary.id}/400/720`,
    durationSec: summary.durationSec,
    privacy: (summary.privacy as Video['privacy']) ?? 'public',
    interaction: {
      allowComments: true,
      allowShare: true,
      allowDownload: true,
      allowRemix: true,
      allowDuet: true,
    },
    stats: { ...summary.stats, saves: 0 },
    liked: false,
    saved: false,
    category: 'general',
    createdAt: summary.createdAt,
  };
}

/** Shared implementation behind both the Profile tab and pushed Profile routes. */
function ProfileView({
  userId,
  navigation,
  isTabScreen,
}: {
  userId: string;
  navigation: RootScreenProps<'Profile'>['navigation'];
  isTabScreen?: boolean;
}) {
  const theme = useTheme();
  const gridTile = useGridTileWidth(3, GRID_GAP);
  const { user: me, isFollowing, toggleFollow } = useApp();
  const [tab, setTab] = useState<ProfileTab>('videos');
  const [menuOpen, setMenuOpen] = useState(false);

  const { user: liveUser } = useSession();
  const { track } = useEventQueue();

  const isMe = userId === me.id;

  /**
   * Somebody else's profile, from the server.
   *
   * This used to be `getUser(userId)`, which returns the sample set's entry for
   * that id and `currentUser` for anything it does not recognise. Every real
   * account therefore opened as the same invented person, with their follower
   * and like counts — so a notification from a new account led to a profile
   * claiming 128K followers. An id the server does not know is now an empty
   * profile, which is the truth.
   */
  const { data: liveOther, source: otherSource } = useApiData<PublicUser | null>(
    () => usersApi.byHandle(userId),
    null,
    [userId],
    { enabled: !isMe, requiresAuth: false, fallbackOnEmpty: false },
  );

  const otherUser: User | null =
    !isMe && otherSource === 'live' && liveOther ? toUser(liveOther) : null;

  const user = isMe
    ? liveUser
      ? {
          ...me,
          id: liveUser.id,
          username: liveUser.username,
          displayName: liveUser.displayName,
          bio: liveUser.bio || me.bio,
          avatar: liveUser.avatar ?? me.avatar,
          followers: liveUser.followers,
          following: liveUser.following,
          likes: liveUser.likes,
          videos: liveUser.videos,
          accountCategory: liveUser.accountCategory,
          accountType: liveUser.accountType,
          verification: liveUser.verificationTier,
        }
      : me
    : (otherUser ?? getUser(userId));

  const following = isFollowing(user);
  const isBusiness = user.accountCategory === 'business';

  /**
   * Someone else's profile, opened.
   *
   * `profile_visit` has been in the event taxonomy since Phase 6 and nothing
   * ever emitted it, so every screen counting profile visits — the creator
   * dashboard and the business one — was reading a column no writer wrote to.
   * A metric that is permanently zero is worse than a missing one: it looks
   * measured. Own-profile opens are excluded, or a business could inflate its
   * own reach by pulling to refresh.
   */
  useEffect(() => {
    if (isMe || !otherUser) return;
    track('profile_visit', { creatorId: otherUser.id, feedSource: 'profile' });
  }, [isMe, otherUser?.id, track]);

  // The creator's own videos, live where the account exists on the server.
  const { data: liveVideos, source: videosSource } = useApiData<VideoSummary[]>(
    () => (isMe ? videosApi.mine(30) : videosApi.byUser(user.username, 30)),
    [],
    [isMe, user.username],
  );

  const authored = useMemo(() => {
    if (videosSource === 'live') {
      return liveVideos.map((v) => toVideoCard(v, user));
    }
    return isMe ? myVideos : videos.filter((v) => v.author.id === user.id);
  }, [videosSource, liveVideos, isMe, user]);

  /**
   * Whether this profile is a real account the server answered for.
   *
   * When it is, an empty grid stays empty. It used to fall through to
   * `videos.slice(0, 6)`, which put six sample clips with millions of plays on
   * the profile of an account that had never posted — a real name above content
   * belonging to nobody. Sample tiles are only right when the whole screen is
   * running on samples because the backend is unreachable.
   */
  const realAccount = isMe || otherUser !== null;

  const list =
    tab === 'liked'
      ? realAccount && !isMe
        ? []
        : likedVideos
      : tab === 'saved'
        ? savedVideos
        : tab === 'private'
          ? authored.filter((v) => v.privacy !== 'public')
          : authored.length > 0
            ? authored
            : realAccount
              ? []
              : videos.slice(0, 6);

  const tabs: { id: ProfileTab; label: string }[] = isMe
    ? [
        { id: 'videos', label: 'Videos' },
        { id: 'liked', label: 'Liked' },
        { id: 'saved', label: 'Saved' },
        { id: 'private', label: 'Private' },
      ]
    : [
        { id: 'videos', label: 'Videos' },
        { id: 'liked', label: 'Liked' },
      ];

  const stats = [
    { label: 'Following', value: user.following, onPress: () => navigation.navigate('Following', { userId: user.id }) },
    { label: 'Followers', value: user.followers, onPress: () => navigation.navigate('Followers', { userId: user.id }) },
    { label: 'Likes', value: user.likes },
  ];

  const menuItems = isMe
    ? [
        { id: 'settings', label: 'Settings and privacy', icon: 'settings-outline' as const, onPress: () => navigation.navigate('Settings') },
        { id: 'dashboard', label: 'Creator dashboard', icon: 'stats-chart-outline' as const, onPress: () => navigation.navigate('CreatorDashboard') },
        { id: 'wallet', label: 'Wallet and coins', icon: 'wallet-outline' as const, onPress: () => navigation.navigate('Wallet') },
        { id: 'monetization', label: 'Monetization', icon: 'ribbon-outline' as const, onPress: () => navigation.navigate('Monetization') },
        { id: 'tasks', label: 'Daily tasks and rewards', icon: 'checkbox-outline' as const, onPress: () => navigation.navigate('DailyTasks') },
        { id: 'refer', label: 'Refer and earn', icon: 'people-outline' as const, onPress: () => navigation.navigate('Referral') },
        { id: 'ads', label: 'Advertising', icon: 'megaphone-outline' as const, onPress: () => navigation.navigate('Ads') },
        { id: 'verify', label: 'Verification', icon: 'checkmark-circle-outline' as const, onPress: () => navigation.navigate('Verification') },
        { id: 'drafts', label: 'Drafts', icon: 'document-outline' as const, onPress: () => navigation.navigate('Drafts') },
      ]
    : [
        { id: 'report', label: 'Report', icon: 'flag-outline' as const, danger: true },
        { id: 'block', label: 'Block', icon: 'ban-outline' as const, danger: true },
        { id: 'copy', label: 'Copy profile link', icon: 'link-outline' as const },
        { id: 'share', label: 'Share profile', icon: 'share-social-outline' as const },
      ];

  return (
    <Screen>
      <Header
        showBack={!isTabScreen}
        center={
          <View style={styles.headerTitle}>
            <Text variant="bodyStrong" numberOfLines={1}>
              @{user.username}
            </Text>
            <VerifiedBadge tier={user.verification} size={13} />
          </View>
        }
        right={
          <View style={styles.headerActions}>
            {isMe ? (
              <IconButton icon="add-circle-outline" size={22} onPress={() => navigation.navigate('Record')} />
            ) : null}
            <IconButton icon="menu-outline" size={22} onPress={() => setMenuOpen(true)} />
          </View>
        }
      />

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={[styles.identity, { padding: theme.spacing.md }]}>
              <Avatar uri={user.avatar} size={88} live={user.isLive} />
              <Text variant="h3" style={{ marginTop: theme.spacing.sm }}>
                {user.displayName}
              </Text>

              {isBusiness && user.businessCategory ? (
                <Badge label={user.businessCategory} tone="gold" size="sm" style={{ marginTop: 4 }} />
              ) : null}

              <View style={[styles.statsRow, { marginTop: theme.spacing.md }]}>
                {stats.map((stat) => (
                  <Pressable key={stat.label} onPress={stat.onPress} style={styles.stat}>
                    <Text variant="h3">{formatCount(stat.value)}</Text>
                    <Text variant="caption" tone="muted">
                      {stat.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {user.bio ? (
                <Text variant="body" align="center" style={{ marginTop: theme.spacing.sm, maxWidth: 320 }}>
                  {user.bio}
                </Text>
              ) : null}

              {user.links?.map((link) => (
                <Pressable
                  key={link}
                  onPress={() => Linking.openURL(`https://${link}`).catch(() => {})}
                  style={styles.linkRow}
                >
                  <Ionicons name="link-outline" size={13} color={theme.colors.accent} />
                  <Text variant="label" tone="accent">
                    {link}
                  </Text>
                </Pressable>
              ))}

              {/* Business contact block */}
              {isBusiness ? (
                <View style={[styles.businessRow, { marginTop: theme.spacing.sm }]}>
                  {user.website ? (
                    <View style={styles.businessItem}>
                      <Ionicons name="globe-outline" size={13} color={theme.colors.textSecondary} />
                      <Text variant="caption" tone="secondary">
                        {user.website}
                      </Text>
                    </View>
                  ) : null}
                  {user.contactEmail ? (
                    <View style={styles.businessItem}>
                      <Ionicons name="mail-outline" size={13} color={theme.colors.textSecondary} />
                      <Text variant="caption" tone="secondary">
                        {user.contactEmail}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Actions */}
              <View style={[styles.actions, { marginTop: theme.spacing.md }]}>
                {isMe ? (
                  <>
                    <Button
                      label="Edit profile"
                      variant="secondary"
                      style={styles.flex}
                      onPress={() => navigation.navigate('EditProfile')}
                    />
                    <Button
                      label="Dashboard"
                      variant="secondary"
                      style={styles.flex}
                      onPress={() =>
                        navigation.navigate(isBusiness ? 'BusinessAnalytics' : 'CreatorDashboard')
                      }
                    />
                    <IconButton icon="bookmark-outline" circle onPress={() => setTab('saved')} />
                  </>
                ) : (
                  <>
                    <Button
                      label={following ? 'Following' : 'Follow'}
                      variant={following ? 'secondary' : 'gradient'}
                      style={styles.flex}
                      onPress={() => toggleFollow(user.id)}
                    />
                    <Button
                      label="Message"
                      variant="secondary"
                      style={styles.flex}
                      onPress={() => navigation.navigate('PrivateChat', { chatId: 'ch_1' })}
                    />
                    <IconButton
                      icon="gift-outline"
                      circle
                      onPress={() => navigation.navigate('Wallet')}
                    />
                  </>
                )}
              </View>

              {/* Business CTA */}
              {isBusiness && user.cta ? (
                <Button
                  label={user.cta.label}
                  variant="primary"
                  fullWidth
                  icon="open-outline"
                  style={{ marginTop: theme.spacing.sm }}
                  onPress={() => {
                    // Counted before the link opens: the app may be backgrounded
                    // by the browser a moment later, and the queue flushes on
                    // that transition.
                    if (!isMe) track('cta_click', { creatorId: user.id });
                    Linking.openURL(user.cta!.url).catch(() => {});
                  }}
                />
              ) : null}
            </View>

            <View
              style={{
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
              }}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TopTabs tabs={tabs} value={tab} onChange={setTab} />
              </ScrollView>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={tab === 'saved' ? 'bookmark-outline' : tab === 'liked' ? 'heart-outline' : 'videocam-outline'}
            title={
              tab === 'saved'
                ? 'Nothing saved yet'
                : tab === 'liked'
                  ? 'No liked videos'
                  : tab === 'private'
                    ? 'No private videos'
                    : 'No videos yet'
            }
            description={isMe && tab === 'videos' ? 'Your published videos will appear here.' : undefined}
            actionLabel={isMe && tab === 'videos' ? 'Create your first video' : undefined}
            onAction={() => navigation.navigate('Record')}
          />
        }
        renderItem={({ item }) => (
          <VideoTile
            video={item}
            width={gridTile}
            onPress={() => navigation.navigate('VideoPlayer', { videoId: item.id })}
          />
        )}
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} height={0.5} showClose title="Options">
        <ScrollView>
          {menuItems.map((item) => (
            <ListRow
              key={item.id}
              label={item.label}
              icon={item.icon}
              danger={'danger' in item ? item.danger : false}
              onPress={() => {
                setMenuOpen(false);
                if ('onPress' in item && item.onPress) item.onPress();
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

/** Pushed route — someone else's profile (creator or business). */
export function ProfileScreen({ navigation, route }: RootScreenProps<'Profile'>) {
  return <ProfileView userId={route.params.userId} navigation={navigation} />;
}

/** Bottom-tab route — always the signed-in user. */
export function MyProfileScreen({ navigation }: TabScreenProps<'ProfileTab'>) {
  const { user } = useApp();
  return (
    <ProfileView
      userId={user.id}
      navigation={navigation as unknown as RootScreenProps<'Profile'>['navigation']}
      isTabScreen
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  identity: { alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: 32 },
  stat: { alignItems: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  businessRow: { alignItems: 'center', gap: 4 },
  businessItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actions: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', paddingHorizontal: 4 },
});
