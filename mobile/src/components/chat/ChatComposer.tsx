import React, { useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Sheet, SheetActionRow } from '../Sheet';
import { useTheme } from '../../theme';

/**
 * Message composer shared by private chats, group chats and communities.
 * `disabledReason` renders a read-only bar — used when a community restricts posting.
 */
export function ChatComposer({
  onSend,
  replyingTo,
  onCancelReply,
  disabledReason,
  onTypingChange,
}: {
  onSend: (text: string) => void;
  replyingTo?: { senderName: string; preview: string } | null;
  onCancelReply?: () => void;
  disabledReason?: string;
  /**
   * Called as the field gains and loses content. Absent when there is no
   * realtime connection, so the composer does not signal into nothing.
   */
  onTypingChange?: (isTyping: boolean) => void;
}) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);

  if (disabledReason) {
    return (
      <View
        style={[
          styles.disabled,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            padding: theme.spacing.md,
          },
        ]}
      >
        <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textMuted} />
        <Text variant="label" tone="muted" align="center">
          {disabledReason}
        </Text>
      </View>
    );
  }

  /**
   * Typing is reported on the transition, not on every keystroke: the socket
   * needs to know that someone started and that they stopped, and a signal per
   * character would be a message per character.
   */
  const change = (next: string) => {
    const wasTyping = value.trim().length > 0;
    const nowTyping = next.trim().length > 0;
    if (wasTyping !== nowTyping) onTypingChange?.(nowTyping);
    setValue(next);
  };

  const send = () => {
    if (!value.trim()) return;
    onSend(value.trim());
    setValue('');
    onTypingChange?.(false);
    onCancelReply?.();
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.bg,
          borderTopColor: theme.colors.border,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
      ]}
    >
      {replyingTo ? (
        <View
          style={[
            styles.replyBar,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm },
          ]}
        >
          <View style={[styles.replyAccent, { backgroundColor: theme.colors.brand }]} />
          <View style={styles.flex}>
            <Text variant="caption" tone="brand">
              Replying to {replyingTo.senderName}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {replyingTo.preview}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="close" size={16} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.row}>
        <Pressable onPress={() => setAttachOpen(true)} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="add-circle-outline" size={26} color={theme.colors.textSecondary} />
        </Pressable>

        <View
          style={[
            styles.inputWrap,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill },
          ]}
        >
          <TextInput
            value={value}
            onChangeText={change}
            placeholder="Message"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            style={[theme.typography.body, styles.input, { color: theme.colors.text }]}
          />
          <Pressable hitSlop={theme.layout.hitSlop}>
            <Ionicons name="happy-outline" size={20} color={theme.colors.textMuted} />
          </Pressable>
        </View>

        {value.trim() ? (
          <Pressable onPress={send} haptic hitSlop={theme.layout.hitSlop}>
            <Ionicons name="send" size={22} color={theme.colors.brand} />
          </Pressable>
        ) : (
          <Pressable
            onPressIn={() => setRecording(true)}
            onPressOut={() => setRecording(false)}
            hitSlop={theme.layout.hitSlop}
          >
            <Ionicons
              name={recording ? 'radio-button-on' : 'mic-outline'}
              size={24}
              color={recording ? theme.colors.brand : theme.colors.textSecondary}
            />
          </Pressable>
        )}
      </View>

      {recording ? (
        <View style={styles.recordingHint}>
          <Text variant="caption" tone="brand">
            Recording voice note — release to send
          </Text>
        </View>
      ) : null}

      <Sheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Attach"
        height={0.3}
        showClose
      >
        <SheetActionRow
          actions={[
            { id: 'camera', label: 'Camera', icon: 'camera-outline', onPress: () => setAttachOpen(false) },
            { id: 'gallery', label: 'Gallery', icon: 'images-outline', onPress: () => setAttachOpen(false) },
            { id: 'video', label: 'Video', icon: 'videocam-outline', onPress: () => setAttachOpen(false) },
            { id: 'document', label: 'Document', icon: 'document-outline', onPress: () => setAttachOpen(false) },
            { id: 'share', label: 'Share video', icon: 'play-circle-outline', onPress: () => setAttachOpen(false) },
          ]}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 40,
    maxHeight: 120,
  },
  input: { flex: 1, paddingVertical: 10 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, marginBottom: 6 },
  replyAccent: { width: 3, height: 30, borderRadius: 2 },
  recordingHint: { alignItems: 'center', paddingTop: 6 },
  disabled: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
