import React, { useState, useRef } from 'react';
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  VerifiedBadge,
  IconButton,
  Sheet,
  ListRow,
  EmptyState,
} from '../../components';
import { MessageBubble } from '../../components/chat/MessageBubble';
import { ChatComposer } from '../../components/chat/ChatComposer';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useConversation } from '../../hooks/useChat';
import { useTyping } from '../../realtime';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { chats, messages as mockMessages, currentUser } from '../../mock';
import { timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { Message, User } from '../../types';
import type { Message as ApiMessage } from '../../../../shared/contracts/messaging';

export function PrivateChatScreen({ navigation, route }: RootScreenProps<'PrivateChat'>) {
  const theme = useTheme();
  const { chatId } = route.params;
  const { user: me } = useCurrentUser();

  // Live thread, socket-fed. `live` is false with no backend, and the screen
  // falls back to the sample conversation rather than showing an empty room.
  const conversation = useConversation(chatId);
  const { typing, setTyping } = useTyping(conversation.live ? chatId : null);

  const sampleChat = chats.find((c) => c.id === chatId) ?? chats[0];
  const sampleOther =
    sampleChat.participants.find((p) => p.id !== currentUser.id) ?? sampleChat.participants[0];

  /**
   * A stand-in for the person while their conversation is still loading.
   *
   * Not the sample person. `conversation.chat` is null for the moment between
   * opening the screen and the server answering, and it stays null if the chat
   * cannot be loaded at all — and in both cases the header used to show a
   * sample contact's name and face over a real conversation. An unnamed
   * placeholder is honest about knowing nothing yet; somebody else's name is
   * not.
   */
  const pendingOther: User = {
    ...sampleOther,
    id: '',
    username: '',
    displayName: conversation.loading ? 'Loading…' : 'Conversation unavailable',
    avatar: '',
    verification: 'none',
  };

  /** The other person, from the server when there is one. */
  const other: User = conversation.chat
    ? (() => {
        const found = conversation.chat.participants.find((p) => p.id !== me.id);
        if (!found) return conversation.live ? pendingOther : sampleOther;
        return {
          id: found.id,
          username: found.username,
          displayName: found.displayName,
          avatar: found.avatar ?? `https://i.pravatar.cc/150?u=${found.username}`,
          accountCategory: found.accountCategory,
          accountType: found.accountType as User['accountType'],
          verification: found.verificationTier,
          followers: found.followers,
          following: found.following,
          likes: found.likes,
          videos: found.videos,
        };
      })()
    : conversation.live
      ? pendingOther
      : sampleOther;

  // In live mode an unloaded conversation is not quietly replaced by a sample
  // one; the screen shows an empty thread under a placeholder header instead.
  const chat = conversation.chat ?? (conversation.live ? null : sampleChat);

  /**
   * The server returns newest first; this list renders oldest at the top, so the
   * order is reversed once here rather than in three places below.
   */
  const toUiMessage = (m: ApiMessage): Message => ({
    id: m.id,
    chatId: m.chatId,
    // The optimistic bubble carries 'me'; a server message carries a public id.
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
    mockMessages[sampleChat.id] ?? mockMessages.ch_1 ?? [],
  );

  const thread: Message[] = conversation.live
    ? [...conversation.messages].reverse().map(toUiMessage)
    : localThread;

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionFor, setActionFor] = useState<Message | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

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

    // No backend: the message stays on the device.
    const message: Message = {
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
            senderName: replyingTo.senderId === currentUser.id ? 'You' : other.displayName,
            preview: replyingTo.text ?? 'Attachment',
          }
        : undefined,
    };
    setLocalThread((prev) => [...prev, message]);
    setReplyingTo(null);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const isTyping = typing.length > 0;
  const myId = conversation.live ? me.id : currentUser.id;

  const menuItems = [
    { id: 'profile', label: 'View profile', icon: 'person-outline' as const, onPress: () => navigation.navigate('Profile', { userId: other.id }) },
    { id: 'media', label: 'Shared media', icon: 'images-outline' as const },
    { id: 'mute', label: chat?.isMuted ? 'Unmute notifications' : 'Mute notifications', icon: 'notifications-off-outline' as const },
    { id: 'search', label: 'Search in conversation', icon: 'search-outline' as const },
    { id: 'block', label: 'Block', icon: 'ban-outline' as const, danger: true },
    { id: 'report', label: 'Report', icon: 'flag-outline' as const, danger: true },
    { id: 'delete', label: 'Delete conversation', icon: 'trash-outline' as const, danger: true },
  ];

  return (
    <Screen>
      <Header
        center={
          <Pressable
            onPress={() => navigation.navigate('Profile', { userId: other.id })}
            style={styles.headerCenter}
          >
            <Avatar uri={other.avatar} size={34} />
            <View>
              <View style={styles.nameRow}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {other.displayName}
                </Text>
                <VerifiedBadge tier={other.verification} size={12} />
              </View>
              <Text variant="caption" tone={chat?.isOnline ? 'success' : 'muted'}>
                {isTyping
                  ? 'typing...'
                  : chat?.isOnline
                    ? 'Online'
                    : sampleChat.lastSeen && !conversation.live
                      ? `Last seen ${timeAgo(sampleChat.lastSeen)}`
                      : 'Offline'}
              </Text>
            </View>
          </Pressable>
        }
        right={
          <View style={styles.headerActions}>
            <IconButton
              icon="call-outline"
              size={21}
              onPress={() => navigation.navigate('VoiceCall', { userId: other.id })}
            />
            <IconButton
              icon="videocam-outline"
              size={21}
              onPress={() => navigation.navigate('VideoCall', { userId: other.id })}
            />
            <IconButton icon="ellipsis-vertical" size={19} onPress={() => setMenuOpen(true)} />
          </View>
        }
      />

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
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-outline"
              title="Say hello"
              description={`This is the start of your conversation with ${other.displayName}.`}
            />
          }
          renderItem={({ item, index }) => {
            const isMine = item.senderId === myId;
            const previous = thread[index - 1];
            const showAvatar = !previous || previous.senderId !== item.senderId;
            return (
              <MessageBubble
                message={item}
                isMine={isMine}
                sender={isMine ? (conversation.live ? me : currentUser) : other}
                showAvatar={showAvatar}
                onLongPress={() => setActionFor(item)}
                // A failed send is tappable: the retry reuses the original
                // client id, so it cannot become a second message.
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
                    replyingTo.senderId === currentUser.id ? 'You' : other.displayName,
                  preview: replyingTo.text ?? 'Attachment',
                }
              : null
          }
          onCancelReply={() => setReplyingTo(null)}
        />
      </KeyboardAvoidingView>

      {/* Conversation menu */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Options" height={0.55} showClose>
        {menuItems.map((item) => (
          <ListRow
            key={item.id}
            label={item.label}
            icon={item.icon}
            danger={item.danger}
            onPress={() => {
              setMenuOpen(false);
              item.onPress?.();
            }}
          />
        ))}
      </Sheet>

      {/* Message actions */}
      <Sheet
        visible={actionFor !== null}
        onClose={() => setActionFor(null)}
        title="Message"
        height={0.42}
        showClose
      >
        {[
          { id: 'reply', label: 'Reply', icon: 'arrow-undo-outline' as const },
          { id: 'forward', label: 'Forward', icon: 'arrow-redo-outline' as const },
          { id: 'copy', label: 'Copy text', icon: 'copy-outline' as const },
          { id: 'delete_me', label: 'Delete for me', icon: 'trash-outline' as const, danger: true },
          // Only the sender may withdraw a message for everyone. Offering it on
          // someone else's message is a button that always fails.
          ...(actionFor && actionFor.senderId === myId
            ? [{ id: 'delete_all', label: 'Delete for everyone', icon: 'trash-bin-outline' as const, danger: true }]
            : []),
        ].map((action) => (
          <ListRow
            key={action.id}
            label={action.label}
            icon={action.icon}
            danger={action.danger}
            onPress={() => {
              if (action.id === 'reply' && actionFor) setReplyingTo(actionFor);

              if (action.id.startsWith('delete') && actionFor) {
                const forEveryone = action.id === 'delete_all';
                if (conversation.live) {
                  // The server decides whether this is allowed: only the sender
                  // may withdraw a message for everyone.
                  void conversation.remove(actionFor.id, forEveryone);
                } else {
                  setLocalThread((prev) =>
                    forEveryone
                      ? prev.map((m) => (m.id === actionFor.id ? { ...m, isDeleted: true } : m))
                      : prev.filter((m) => m.id !== actionFor.id),
                  );
                }
              }
              setActionFor(null);
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
