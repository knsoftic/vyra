import React, { useState, useRef } from 'react';
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  Badge,
  IconButton,
  EmptyState,
  CountBadge,
} from '../../components';
import { MessageBubble } from '../../components/chat/MessageBubble';
import { ChatComposer } from '../../components/chat/ChatComposer';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useCommunity } from '../../hooks/useCommunities';
import { useConversation } from '../../hooks/useChat';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { communities as sampleCommunities, currentUser, getUser, users } from '../../mock';
import { formatCount, minutesAgo, hoursAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { Message } from '../../types';

export function CommunityScreen({ navigation, route }: RootScreenProps<'Community'>) {
  const theme = useTheme();
  const { communityId } = route.params;

  const { user: me } = useCurrentUser();

  // Two reads: the community for its policy and identity, and the chat behind it
  // for the conversation. They are separate rows and separate concerns.
  const detail = useCommunity(communityId);
  const conversation = useConversation(detail.raw?.chatId ?? null);

  const sample = sampleCommunities.find((c) => c.id === communityId) ?? sampleCommunities[0];
  const community = detail.community ?? sample;
  const live = detail.community !== null;
  const isStaff = community.myRole !== 'member';

  /** Participants, so a bubble can be attributed. */
  const memberById = new Map<string, (typeof users)[number]>();
  if (conversation.chat) {
    for (const p of conversation.chat.participants) {
      memberById.set(p.id, {
        id: p.id,
        username: p.username,
        displayName: p.displayName,
        avatar: p.avatar ?? `https://i.pravatar.cc/150?u=${p.username}`,
        accountCategory: p.accountCategory,
        accountType: p.accountType as (typeof users)[number]['accountType'],
        verification: p.verificationTier,
        followers: p.followers,
        following: p.following,
        likes: p.likes,
        videos: p.videos,
      });
    }
  }

  const myId = live ? me.id : currentUser.id;

  const [localThread, setLocalThread] = useState<Message[]>([
    {
      id: 'cm_m1',
      chatId: community.id,
      senderId: users[1].id,
      kind: 'text',
      text: 'Shipped the first version of my analytics dashboard today. Three weeks of evenings.',
      createdAt: hoursAgo(4),
      status: 'seen',
    },
    {
      id: 'cm_m2',
      chatId: community.id,
      senderId: users[7].id,
      kind: 'text',
      text: 'That is a clean layout. What did you use for the charts?',
      createdAt: hoursAgo(3),
      status: 'seen',
    },
    {
      id: 'cm_m3',
      chatId: community.id,
      senderId: users[1].id,
      kind: 'text',
      text: 'Wrote them by hand. No chart library, just views and flexbox.',
      createdAt: hoursAgo(3),
      status: 'seen',
    },
    {
      id: 'cm_m4',
      chatId: community.id,
      senderId: users[9].id,
      kind: 'image',
      mediaUrl: 'https://picsum.photos/seed/community1/600/800',
      text: 'Mine for comparison',
      createdAt: hoursAgo(1),
      status: 'seen',
    },
    {
      id: 'cm_m5',
      chatId: community.id,
      senderId: users[5].id,
      kind: 'text',
      text: 'Both look better than what I shipped last month, honestly.',
      createdAt: minutesAgo(24),
      status: 'delivered',
    },
  ]);

  const listRef = useRef<FlatList<Message>>(null);

  const thread: Message[] = conversation.live
    ? [...conversation.messages].reverse().map((m) => ({
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId === 'me' ? me.id : m.senderId,
        kind: m.kind,
        createdAt: m.createdAt,
        status: m.status,
        ...(m.body ? { text: m.body } : {}),
        ...(m.mediaUrl ? { mediaUrl: m.mediaUrl } : {}),
        ...(m.isDeleted ? { isDeleted: true } : {}),
      }))
    : localThread;

  const send = (text: string) => {
    if (conversation.live) {
      void conversation.send({ kind: 'text', body: text });
      return;
    }
    setLocalThread((prev) => [
      ...prev,
      {
        id: `cm_${Date.now()}`,
        chatId: community.id,
        senderId: currentUser.id,
        kind: 'text',
        text,
        createdAt: new Date().toISOString(),
        status: 'sent',
      },
    ]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <Screen>
      <Header
        center={
          <Pressable
            onPress={() => navigation.navigate('CommunityInfo', { communityId: community.id })}
            style={styles.headerCenter}
          >
            <Avatar uri={community.logo} size={34} />
            <View>
              <View style={styles.titleRow}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {community.name}
                </Text>
                {community.isPrivate ? (
                  <Ionicons name="lock-closed" size={11} color={theme.colors.textMuted} />
                ) : null}
              </View>
              {/* Members see the count, never the roster (ADR-014). */}
              <Text variant="caption" tone="muted">
                {formatCount(community.memberCount)} members
              </Text>
            </View>
          </Pressable>
        }
        right={
          <View style={styles.headerActions}>
            {isStaff && (community.pendingRequests ?? 0) > 0 ? (
              <Pressable
                onPress={() => navigation.navigate('CommunityRequests', { communityId: community.id })}
                hitSlop={theme.layout.hitSlop}
              >
                <Ionicons name="person-add-outline" size={21} color={theme.colors.text} />
                <View style={styles.badgeDot}>
                  <CountBadge count={community.pendingRequests ?? 0} />
                </View>
              </Pressable>
            ) : null}
            <IconButton
              icon="information-circle-outline"
              size={21}
              onPress={() => navigation.navigate('CommunityInfo', { communityId: community.id })}
            />
          </View>
        }
      />

      {/* Announcement */}
      {community.announcement ? (
        <View
          style={[
            styles.announcement,
            {
              backgroundColor: theme.colors.brandSoft,
              borderBottomColor: theme.colors.border,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
            },
          ]}
        >
          <Ionicons name="megaphone-outline" size={16} color={theme.colors.brand} />
          <View style={styles.flex}>
            <Text variant="caption" tone="brand">
              Announcement
            </Text>
            <Text variant="label" numberOfLines={2}>
              {community.announcement}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
        <SourceTag
          source={conversation.live ? 'live' : 'sample'}
          noun="community"
          {...(conversation.live ? {} : { detail: 'not sent anywhere' })}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={listRef}
          data={thread}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: theme.spacing.sm }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <View style={[styles.intro, { paddingHorizontal: theme.spacing.lg }]}>
              <Badge
                label={community.isPrivate ? 'Private community' : 'Public community'}
                tone="neutral"
                size="sm"
              />
              <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.xs }}>
                Be useful. Read the rules before posting.
              </Text>
            </View>
          }
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No messages yet" />}
          renderItem={({ item, index }) => {
            const isMine = item.senderId === myId;
            const previous = thread[index - 1];
            const showAvatar = !previous || previous.senderId !== item.senderId;
            const sender = conversation.live
              ? (isMine ? me : memberById.get(item.senderId))
              : getUser(item.senderId);
            return (
              <MessageBubble
                message={item}
                isMine={isMine}
                sender={sender}
                showAvatar={showAvatar}
              />
            );
          }}
        />

        <ChatComposer
          onSend={send}
          disabledReason={
            community.permissions.canPost || isStaff
              ? live && community.myRole === undefined
                ? 'Join this community to post'
                : undefined
              : 'Only moderators can post in this community'
          }
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badgeDot: { position: 'absolute', top: -8, right: -10 },
  announcement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  intro: { alignItems: 'center', paddingBottom: 16 },
});
