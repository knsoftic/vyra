import React, { useState, useRef } from 'react';
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  AvatarGroup,
  IconButton,
  EmptyState,
} from '../../components';
import { MessageBubble } from '../../components/chat/MessageBubble';
import { ChatComposer } from '../../components/chat/ChatComposer';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useConversation } from '../../hooks/useChat';
import { useTyping } from '../../realtime';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { chats, messages as mockMessages, currentUser, getUser } from '../../mock';
import type { RootScreenProps } from '../../navigation/types';
import type { Message, User } from '../../types';
import type { Message as ApiMessage } from '../../../../shared/contracts/messaging';

export function GroupChatScreen({ navigation, route }: RootScreenProps<'GroupChat'>) {
  const theme = useTheme();
  const { chatId } = route.params;

  const { user: me } = useCurrentUser();

  // The same hook the private chat uses: a group is a chat with more people in
  // it, not a different kind of conversation.
  const conversation = useConversation(chatId);
  const { typing, setTyping } = useTyping(conversation.live ? chatId : null);

  const sampleChat = chats.find((c) => c.id === chatId) ?? chats[2];

  /** Participants, so a bubble can be attributed to whoever wrote it. */
  const memberById = new Map<string, User>();
  if (conversation.chat) {
    for (const p of conversation.chat.participants) {
      memberById.set(p.id, {
        id: p.id,
        username: p.username,
        displayName: p.displayName,
        avatar: p.avatar ?? `https://i.pravatar.cc/150?u=${p.username}`,
        accountCategory: p.accountCategory,
        accountType: p.accountType as User['accountType'],
        verification: p.verificationTier,
        followers: p.followers,
        following: p.following,
        likes: p.likes,
        videos: p.videos,
      });
    }
  }

  const chat = conversation.chat
    ? {
        ...sampleChat,
        id: conversation.chat.id,
        title: conversation.chat.title,
        participants: [...memberById.values()],
      }
    : sampleChat;

  const toUiMessage = (m: ApiMessage): Message => ({
    id: m.id,
    chatId: m.chatId,
    senderId: m.senderId === 'me' ? me.id : m.senderId,
    kind: m.kind,
    createdAt: m.createdAt,
    status: m.status,
    ...(m.body ? { text: m.body } : {}),
    ...(m.mediaUrl ? { mediaUrl: m.mediaUrl } : {}),
    ...(m.durationSec ? { durationSec: m.durationSec } : {}),
    ...(m.fileName ? { fileName: m.fileName } : {}),
    ...(m.isDeleted ? { isDeleted: true } : {}),
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
  });

  const [localThread, setLocalThread] = useState<Message[]>(
    mockMessages[sampleChat.id] ?? mockMessages.ch_3 ?? [],
  );

  const thread: Message[] = conversation.live
    ? [...conversation.messages].reverse().map(toUiMessage)
    : localThread;

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const myId = conversation.live ? me.id : currentUser.id;
  const isTyping = typing.length > 0;

  const pinned = thread.find((m) => m.id === sampleChat.pinnedMessageId) ?? thread[0];

  const send = (text: string) => {
    if (conversation.live) {
      void conversation.send({
        kind: 'text',
        body: text,
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
      });
      setReplyingTo(null);
      setTyping(false);
      return;
    }

    setLocalThread((prev) => [
      ...prev,
      {
        id: `m_${Date.now()}`,
        chatId: sampleChat.id,
        senderId: currentUser.id,
        kind: 'text',
        text,
        createdAt: new Date().toISOString(),
        status: 'sent',
        replyTo: replyingTo
          ? {
              id: replyingTo.id,
              senderName: getUser(replyingTo.senderId).displayName,
              preview: replyingTo.text ?? 'Attachment',
            }
          : undefined,
      },
    ]);
    setReplyingTo(null);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <Screen>
      <Header
        center={
          <Pressable
            onPress={() => navigation.navigate('GroupInfo', { chatId: chat.id })}
            style={styles.headerCenter}
          >
            <AvatarGroup uris={chat.participants.slice(0, 3).map((p) => p.avatar)} size={30} max={2} />
            <View>
              <Text variant="bodyStrong" numberOfLines={1}>
                {chat.title}
              </Text>
              <Text variant="caption" tone={isTyping ? 'brand' : 'muted'}>
                {isTyping
                  ? `${typing.length} typing…`
                  : `${conversation.chat?.memberCount ?? chat.participants.length} members`}
              </Text>
            </View>
          </Pressable>
        }
        right={
          <View style={styles.headerActions}>
            <IconButton
              icon="videocam-outline"
              size={21}
              onPress={() => navigation.navigate('GroupCall', { chatId: chat.id })}
            />
            <IconButton
              icon="information-circle-outline"
              size={21}
              onPress={() => navigation.navigate('GroupInfo', { chatId: chat.id })}
            />
          </View>
        }
      />

      {/* Pinned message */}
      {pinned ? (
        <Pressable
          style={[
            styles.pinned,
            {
              backgroundColor: theme.colors.surface,
              borderBottomColor: theme.colors.border,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            },
          ]}
        >
          <Ionicons name="pin" size={14} color={theme.colors.brand} />
          <View style={styles.flex}>
            <Text variant="caption" tone="brand">
              Pinned by {getUser(pinned.senderId).displayName}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {pinned.text ?? 'Attachment'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
        <SourceTag
          source={conversation.live ? 'live' : 'sample'}
          noun="conversation"
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
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No messages yet" />}
          renderItem={({ item, index }) => {
            const isMine = item.senderId === myId;
            const previous = thread[index - 1];
            const showAvatar = !previous || previous.senderId !== item.senderId;
            // A live sender is looked up among the participants; `getUser` only
            // knows the sample accounts.
            const sender = conversation.live
              ? (isMine ? me : memberById.get(item.senderId))
              : getUser(item.senderId);
            return (
              <MessageBubble
                message={item}
                isMine={isMine}
                sender={sender}
                showAvatar={showAvatar}
                onLongPress={() => setReplyingTo(item)}
                onPress={
                  item.status === 'failed'
                    ? () => void conversation.retry({
                        id: item.id,
                        chatId: item.chatId,
                        senderId: item.senderId,
                        kind: item.kind,
                        status: 'failed',
                        createdAt: item.createdAt,
                        ...(item.text ? { body: item.text } : {}),
                      })
                    : undefined
                }
              />
            );
          }}
        />

        <ChatComposer
          onSend={send}
          onTypingChange={conversation.live ? setTyping : undefined}
          replyingTo={
            replyingTo
              ? {
                  senderName:
                    (conversation.live
                      ? memberById.get(replyingTo.senderId)?.displayName
                      : getUser(replyingTo.senderId).displayName) ?? 'Someone',
                  preview: replyingTo.text ?? 'Attachment',
                }
              : null
          }
          onCancelReply={() => setReplyingTo(null)}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
