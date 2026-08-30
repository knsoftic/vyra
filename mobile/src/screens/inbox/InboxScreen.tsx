import React, { useState } from 'react';
import { View, StyleSheet, FlatList, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Text,
  Pressable,
  Avatar,
  AvatarGroup,
  NameWithBadge,
  CountBadge,
  Segmented,
  ChipRow,
  EmptyState,
  IconButton,
  Divider,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useInbox } from '../../hooks/useChat';
import { useApiData } from '../../hooks/useApiData';
import { communities as communitiesApi, notifications as notificationsApi, fallbackAvatar } from '../../api';
import { chats as sampleChats, notifications as sampleNotifications, communities, users } from '../../mock';
import { timeAgo, formatClock } from '../../utils/format';
import type { TabScreenProps } from '../../navigation/types';
import type { AppNotification, Chat, User } from '../../types';
import type { Chat as ApiChat } from '../../../../shared/contracts/messaging';
import type { NotificationItem } from '../../api/notifications';

/**
 * A server notification as the row renders it.
 *
 * The server sends only what it knows about the actor — id, username, display
 * name, avatar. The rest of `User` is filled with neutral values rather than
 * invented ones: a follower count of zero here is never displayed, and guessing
 * one would put a fabricated number next to a real name.
 */
function toAppNotification(item: NotificationItem): AppNotification {
  const notification: AppNotification = {
    id: item.id,
    kind: item.kind,
    text: item.body,
    createdAt: item.createdAt,
    read: item.read,
  };

  if (item.actor) {
    notification.actor = {
      id: item.actor.id,
      username: item.actor.username,
      displayName: item.actor.displayName,
      avatar: item.actor.avatar ?? fallbackAvatar(item.actor.username),
      verification: item.actor.verificationTier as User['verification'],
      followers: 0,
      following: 0,
      likes: 0,
      videos: 0,
    } as AppNotification['actor'];
  }

  return notification;
}

type InboxTab = 'chats' | 'activity';
type NotificationFilter = 'all' | 'likes' | 'comments' | 'mentions' | 'followers' | 'system';

export function InboxScreen({ navigation }: TabScreenProps<'Inbox'>) {
  const theme = useTheme();
  const [tab, setTab] = useState<InboxTab>('chats');
  const [filter, setFilter] = useState<NotificationFilter>('all');

  // Live conversations, kept in step with the socket rather than refetched.
  const { chats: liveChats, live, totalUnread, refresh, loading } = useInbox();

  /**
   * The API chat and the UI chat differ in a few fields the components need.
   * Anything the server does not send keeps a neutral default — a made-up
   * "last seen" would be a claim about someone's behaviour nobody measured.
   */
  const toChat = (source: ApiChat): Chat => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    avatar: source.avatar ?? `https://i.pravatar.cc/150?u=${source.id}`,
    participants: source.participants.map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      avatar: p.avatar ?? `https://i.pravatar.cc/150?u=${p.username}`,
      accountCategory: p.accountCategory,
      accountType: p.accountType as Chat['participants'][number]['accountType'],
      verification: p.verificationTier,
      followers: p.followers,
      following: p.following,
      likes: p.likes,
      videos: p.videos,
    })),
    unreadCount: source.unreadCount,
    isMuted: source.isMuted,
    ...(source.isOnline !== undefined ? { isOnline: source.isOnline } : {}),
    ...(source.lastMessage
      ? {
          lastMessage: {
            id: source.lastMessage.id,
            chatId: source.id,
            senderId: source.lastMessage.senderId,
            kind: source.lastMessage.kind,
            createdAt: source.lastMessage.createdAt,
            status: source.lastMessage.status,
            ...(source.lastMessage.body ? { text: source.lastMessage.body } : {}),
            ...(source.lastMessage.fileName ? { fileName: source.lastMessage.fileName } : {}),
            ...(source.lastMessage.isDeleted ? { isDeleted: true } : {}),
          },
        }
      : {}),
  });

  /*
   * An empty inbox is a real answer.
   *
   * This used to read `live && liveChats.length > 0`, so a signed-in person
   * with no conversations was shown the sample ones — a list of messages from
   * people who do not exist, indistinguishable from real ones. Samples belong
   * to sample mode, where the whole screen is labelled as such.
   */
  const chats: Chat[] = live ? liveChats.map(toChat) : sampleChats;

  // Communities the caller is actually in. Not padded with samples: a strip of
  // communities somebody has not joined is an invitation to tap into a group
  // that does not exist.
  const { data: myCommunities, source: communitySource } = useApiData(
    () => communitiesApi.list({ mine: true, limit: 12 }).then((page) => page.items),
    [],
    [],
    { fallbackOnEmpty: false },
  );

  const communityStrip =
    communitySource === 'live'
      ? myCommunities.map((c) => ({
          id: c.id,
          name: c.name,
          logo: c.avatar ?? `https://picsum.photos/seed/${c.id}/200/200`,
          unreadCount: 0,
        }))
      : communities;

  // Your own activity. `fallbackOnEmpty` is false because an empty inbox is a
  // real answer — showing sample likes to someone with none would be inventing
  // engagement they never received.
  const {
    data: liveActivity,
    source: activitySource,
    refresh: refreshActivity,
  } = useApiData<NotificationItem[]>(
    () => notificationsApi.list({ limit: 50 }),
    [],
    [],
    { fallbackOnEmpty: false },
  );

  const activityLive = activitySource === 'live';
  const activity: AppNotification[] = activityLive
    ? liveActivity.map(toAppNotification)
    : sampleNotifications;

  const unreadChats = live ? totalUnread : chats.reduce((sum, chat) => sum + chat.unreadCount, 0);
  const unreadActivity = activity.filter((n) => !n.read).length;

  const filtered = activity.filter((n) => {
    if (filter === 'all') return true;
    if (filter === 'likes') return n.kind === 'like';
    if (filter === 'comments') return n.kind === 'comment';
    if (filter === 'mentions') return n.kind === 'mention';
    if (filter === 'followers') return n.kind === 'follow';
    return n.kind === 'system' || n.kind === 'verification' || n.kind === 'campaign' || n.kind === 'gift';
  });

  const renderChat = ({ item }: { item: Chat }) => {
    const preview =
      item.isTyping
        ? 'typing...'
        : item.lastMessage?.kind === 'voice'
          ? 'Voice message'
          : item.lastMessage?.kind === 'image'
            ? 'Photo'
            : item.lastMessage?.kind === 'video'
              ? 'Video'
              : item.lastMessage?.kind === 'document'
                ? item.lastMessage.fileName ?? 'Document'
                : item.lastMessage?.kind === 'shared_video'
                  ? 'Shared a video'
                  : item.lastMessage?.text ?? '';

    return (
      <Pressable
        onPress={() =>
          navigation.navigate(item.kind === 'group' ? 'GroupChat' : 'PrivateChat', {
            chatId: item.id,
          })
        }
        style={[styles.chatRow, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }]}
      >
        <View>
          {item.kind === 'group' ? (
            <AvatarGroup uris={item.participants.slice(0, 3).map((p) => p.avatar)} size={40} max={2} />
          ) : (
            <Avatar uri={item.avatar} size={52} />
          )}
          {item.isOnline ? (
            <View style={[styles.onlineDot, { backgroundColor: theme.colors.success, borderColor: theme.colors.bg }]} />
          ) : null}
        </View>

        <View style={styles.flex}>
          <View style={styles.chatTop}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {item.title}
            </Text>
            <Text variant="caption" tone="muted">
              {item.lastMessage ? timeAgo(item.lastMessage.createdAt) : ''}
            </Text>
          </View>

          <View style={styles.chatBottom}>
            <Text
              variant="label"
              tone={item.isTyping ? 'brand' : item.unreadCount > 0 ? 'primary' : 'muted'}
              numberOfLines={1}
              style={styles.flex}
            >
              {preview}
            </Text>
            {item.isMuted ? (
              <Ionicons name="notifications-off-outline" size={13} color={theme.colors.textMuted} />
            ) : null}
            <CountBadge count={item.unreadCount} />
          </View>
        </View>
      </Pressable>
    );
  };

  const renderNotification = ({ item }: { item: AppNotification }) => {
    const iconFor: Record<string, keyof typeof Ionicons.glyphMap> = {
      like: 'heart',
      comment: 'chatbubble',
      follow: 'person-add',
      mention: 'at',
      gift: 'gift',
      system: 'megaphone',
      verification: 'checkmark-circle',
      campaign: 'trending-up',
      task: 'ribbon',
    };

    return (
      <Pressable
        onPress={() => {
          // Read state lives on the server, so the badge is still right on the
          // next device. A failure here is silent: it must not block the tap.
          if (activityLive && !item.read) {
            void notificationsApi.markRead(item.id).then(refreshActivity).catch(() => {});
          }
          if (item.actor) navigation.navigate('Profile', { userId: item.actor.id });
        }}
        style={[
          styles.notificationRow,
          {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            backgroundColor: item.read ? 'transparent' : theme.colors.surface,
          },
        ]}
      >
        {item.actor ? (
          <View>
            <Avatar uri={item.actor.avatar} size={44} />
            <View style={[styles.kindDot, { backgroundColor: theme.colors.brand, borderColor: theme.colors.bg }]}>
              <Ionicons name={iconFor[item.kind]} size={10} color="#FFF" />
            </View>
          </View>
        ) : (
          <View style={[styles.systemIcon, { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.pill }]}>
            <Ionicons name={iconFor[item.kind]} size={18} color={theme.colors.textSecondary} />
          </View>
        )}

        <View style={styles.flex}>
          {item.actor ? (
            <NameWithBadge name={item.actor.displayName} tier={item.actor.verification} variant="labelStrong" size={12} />
          ) : null}
          <Text variant="label" tone="secondary" numberOfLines={2}>
            {item.text}
          </Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {timeAgo(item.createdAt)}
          </Text>
        </View>

        {item.videoThumb ? (
          <Image
            source={{ uri: item.videoThumb }}
            style={[styles.thumb, { borderRadius: theme.radius.xs }]}
            contentFit="cover"
          />
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs }]}>
        <Text variant="h2">Inbox</Text>
        <View style={styles.headerActions}>
          <IconButton icon="call-outline" size={21} onPress={() => navigation.navigate('CallHistory')} />
          <IconButton icon="people-outline" size={21} onPress={() => navigation.navigate('Communities')} />
          <IconButton icon="create-outline" size={21} />
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'chats', label: unreadChats > 0 ? `Chats (${unreadChats})` : 'Chats' },
            { id: 'activity', label: unreadActivity > 0 ? `Activity (${unreadActivity})` : 'Activity' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'chats' ? (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          renderItem={renderChat}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <Divider inset={80} />}
          refreshing={loading}
          onRefresh={() => void refresh()}
          ListHeaderComponent={
            <>
              <SourceNote
                source={live && liveChats.length > 0 ? 'live' : 'sample'}
                noun="conversations"
                sampleHint={
                  live
                    ? 'you have no conversations yet — these are examples'
                    : 'sign in to see your messages'
                }
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipRow}
                contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}
              >
                {communityStrip.map((community) => (
                  <Pressable
                    key={community.id}
                    onPress={() => navigation.navigate('Community', { communityId: community.id })}
                    style={styles.community}
                  >
                    <View>
                      <Avatar uri={community.logo} size={54} ring={(community.unreadCount ?? 0) > 0} />
                      <CountBadge count={community.unreadCount ?? 0} />
                    </View>
                    <Text variant="caption" tone="secondary" numberOfLines={1} align="center">
                      {community.name.split(' ')[0]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          }
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No conversations yet" />}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ paddingBottom: theme.spacing.sm }}>
              <SourceNote
                source={activitySource}
                noun="activity"
                liveHint="everything here actually happened on your account"
                sampleHint="sign in to see your own activity"
              />
              <ChipRow
                items={[
                  { id: 'all', label: 'All' },
                  { id: 'likes', label: 'Likes' },
                  { id: 'comments', label: 'Comments' },
                  { id: 'mentions', label: 'Mentions' },
                  { id: 'followers', label: 'Followers' },
                  { id: 'system', label: 'System' },
                ]}
                selectedId={filter}
                onSelect={(id) => setFilter(id as NotificationFilter)}
              />
            </View>
          }
          ListEmptyComponent={<EmptyState icon="notifications-outline" title="Nothing here yet" />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0, flexShrink: 0 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },
  notificationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 40, height: 52 },
  community: { alignItems: 'center', gap: 5, width: 62 },
});
