import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Avatar } from '../Avatar';
import { useTheme } from '../../theme';
import { formatClock, formatDuration } from '../../utils/format';
import { Message, User } from '../../types';

export function MessageBubble({
  message,
  isMine,
  sender,
  showAvatar = true,
  onLongPress,
  onPress,
}: {
  message: Message;
  isMine: boolean;
  sender?: User;
  showAvatar?: boolean;
  onLongPress?: () => void;
  /** Set on a failed send, so tapping the bubble retries it. */
  onPress?: () => void;
}) {
  const theme = useTheme();

  const bubbleColor = isMine ? theme.colors.brand : theme.colors.surface;
  const textTone = isMine ? '#FFFFFF' : theme.colors.text;
  const metaTone = isMine ? 'rgba(255,255,255,0.75)' : theme.colors.textMuted;

  const statusIcon =
    message.status === 'seen'
      ? 'checkmark-done'
      : message.status === 'delivered'
        ? 'checkmark-done-outline'
        : message.status === 'sent'
          ? 'checkmark'
          : 'time-outline';

  const renderContent = () => {
    if (message.isDeleted) {
      return (
        <Text variant="body" style={{ color: metaTone, fontStyle: 'italic' }}>
          This message was deleted
        </Text>
      );
    }

    switch (message.kind) {
      case 'image':
      case 'video':
      case 'shared_video':
        return (
          <View>
            <View style={[styles.media, { borderRadius: theme.radius.sm }]}>
              <Image
                source={{ uri: message.mediaUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              {message.kind !== 'image' ? (
                <View style={styles.playOverlay}>
                  <Ionicons name="play" size={26} color="#FFF" />
                </View>
              ) : null}
            </View>
            {message.text ? (
              <Text variant="body" style={{ color: textTone, marginTop: 6 }}>
                {message.text}
              </Text>
            ) : null}
          </View>
        );

      case 'voice':
        return (
          <View style={styles.voiceRow}>
            <Ionicons name="play-circle" size={30} color={textTone} />
            <View style={styles.waveform}>
              {Array.from({ length: 22 }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.waveBar,
                    {
                      height: 4 + ((index * 7) % 16),
                      backgroundColor: isMine ? 'rgba(255,255,255,0.8)' : theme.colors.borderStrong,
                    },
                  ]}
                />
              ))}
            </View>
            <Text variant="caption" style={{ color: metaTone }}>
              {formatDuration(message.durationSec ?? 0)}
            </Text>
          </View>
        );

      case 'document':
        return (
          <View style={styles.docRow}>
            <View style={[styles.docIcon, { backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : theme.colors.surfaceAlt }]}>
              <Ionicons name="document-text-outline" size={20} color={textTone} />
            </View>
            <View style={styles.flex}>
              <Text variant="label" style={{ color: textTone }} numberOfLines={1}>
                {message.fileName}
              </Text>
              <Text variant="caption" style={{ color: metaTone }}>
                {message.fileSize}
              </Text>
            </View>
            <Ionicons name="download-outline" size={18} color={textTone} />
          </View>
        );

      default:
        return (
          <Text variant="body" style={{ color: textTone }}>
            {message.text}
          </Text>
        );
    }
  };

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      {!isMine && showAvatar ? (
        <Avatar uri={sender?.avatar} size={28} fallbackLabel={sender?.displayName} />
      ) : !isMine ? (
        <View style={styles.avatarSpacer} />
      ) : null}

      <Pressable
        onLongPress={onLongPress}
        onPress={onPress}
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            borderRadius: theme.radius.lg,
            borderBottomRightRadius: isMine ? theme.radius.xs : theme.radius.lg,
            borderBottomLeftRadius: isMine ? theme.radius.lg : theme.radius.xs,
          },
        ]}
      >
        {/* Sender name in group contexts */}
        {!isMine && sender && showAvatar ? (
          <Text variant="caption" tone="brand" style={{ marginBottom: 2 }}>
            {sender.displayName}
          </Text>
        ) : null}

        {/* Reply preview */}
        {message.replyTo ? (
          <View
            style={[
              styles.replyPreview,
              {
                backgroundColor: isMine ? 'rgba(255,255,255,0.18)' : theme.colors.surfaceAlt,
                borderLeftColor: isMine ? '#FFFFFF' : theme.colors.brand,
                borderRadius: theme.radius.xs,
              },
            ]}
          >
            <Text variant="caption" style={{ color: textTone, fontWeight: '600' }}>
              {message.replyTo.senderName}
            </Text>
            <Text variant="caption" style={{ color: metaTone }} numberOfLines={1}>
              {message.replyTo.preview}
            </Text>
          </View>
        ) : null}

        {renderContent()}

        <View style={styles.meta}>
          <Text variant="caption" style={{ color: metaTone }}>
            {formatClock(message.createdAt)}
          </Text>
          {isMine ? (
            <Ionicons
              name={statusIcon}
              size={13}
              color={message.status === 'seen' ? '#8FE3FF' : metaTone}
            />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, marginVertical: 3 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  avatarSpacer: { width: 28 },
  bubble: { maxWidth: '76%', paddingHorizontal: 12, paddingVertical: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 3 },
  media: { width: 200, height: 240, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.2)' },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 180 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  waveBar: { width: 2.5, borderRadius: 2 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200 },
  docIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  replyPreview: { borderLeftWidth: 3, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 5 },
});
