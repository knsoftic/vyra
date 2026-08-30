import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from '../Sheet';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Avatar, NameWithBadge } from '../Avatar';
import { Badge } from '../Cards';
import { EmptyState } from '../Lists';
import { useTheme } from '../../theme';
import { formatCount, timeAgo } from '../../utils/format';
import { comments as mockComments, currentUser } from '../../mock';
import { Comment, Video } from '../../types';

export function CommentsSheet({
  video,
  visible,
  onClose,
}: {
  video: Video | null;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set(['c_1']));
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  const toggleCommentLike = (id: string) => {
    setLikedComments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderComment = (comment: Comment, isReply = false) => {
    const liked = likedComments.has(comment.id);
    return (
      <View key={comment.id} style={[styles.comment, isReply && styles.reply]}>
        <Avatar uri={comment.author.avatar} size={isReply ? 28 : 36} />

        <View style={styles.commentBody}>
          <View style={styles.commentHeader}>
            <NameWithBadge
              name={comment.author.displayName}
              tier={comment.author.verification}
              variant="label"
              tone="secondary"
              size={12}
            />
            {comment.isCreator ? <Badge label="Creator" tone="brand" size="sm" /> : null}
            {comment.isPinned ? <Badge label="Pinned" tone="neutral" size="sm" /> : null}
          </View>

          <Text variant="body" style={{ marginTop: 2 }}>
            {comment.text}
          </Text>

          <View style={styles.commentMeta}>
            <Text variant="caption" tone="muted">
              {timeAgo(comment.createdAt)}
            </Text>
            <Pressable onPress={() => setReplyTo(comment)} hitSlop={theme.layout.hitSlop}>
              <Text variant="caption" tone="muted">
                Reply
              </Text>
            </Pressable>
            {comment.replyCount > 0 && !isReply ? (
              <Pressable hitSlop={theme.layout.hitSlop}>
                <Text variant="caption" tone="brand">
                  View {comment.replyCount} replies
                </Text>
              </Pressable>
            ) : null}
          </View>

          {comment.replies?.map((reply) => renderComment(reply, true))}
        </View>

        <Pressable
          onPress={() => toggleCommentLike(comment.id)}
          hitSlop={theme.layout.hitSlop}
          style={styles.commentLike}
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={16}
            color={liked ? theme.colors.brand : theme.colors.textMuted}
          />
          <Text variant="caption" tone="muted">
            {formatCount(comment.likes + (liked ? 1 : 0))}
          </Text>
        </Pressable>
      </View>
    );
  };

  const commentsDisabled = video ? !video.interaction.allowComments : false;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`${formatCount(video?.stats.comments ?? 0)} comments`}
      height={0.75}
      showClose
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        {commentsDisabled ? (
          <EmptyState
            icon="chatbubble-outline"
            title="Comments are off"
            description="The creator turned off comments for this video."
          />
        ) : (
          <FlatList
            data={mockComments}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderComment(item)}
            contentContainerStyle={{ paddingVertical: theme.spacing.sm }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <EmptyState
                icon="chatbubble-outline"
                title="No comments yet"
                description="Be the first to say something."
              />
            }
          />
        )}

        {!commentsDisabled ? (
          <View
            style={[
              styles.composer,
              {
                borderTopColor: theme.colors.border,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                backgroundColor: theme.colors.bg,
              },
            ]}
          >
            {replyTo ? (
              <View style={styles.replyBanner}>
                <Text variant="caption" tone="muted" style={styles.flex}>
                  Replying to {replyTo.author.displayName}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={theme.layout.hitSlop}>
                  <Ionicons name="close" size={14} color={theme.colors.textMuted} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.composerRow}>
              <Avatar uri={currentUser.avatar} size={32} />
              <View
                style={[
                  styles.inputWrap,
                  { backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill },
                ]}
              >
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Add a comment..."
                  placeholderTextColor={theme.colors.textMuted}
                  style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}
                />
                <Pressable hitSlop={theme.layout.hitSlop}>
                  <Ionicons name="happy-outline" size={18} color={theme.colors.textMuted} />
                </Pressable>
              </View>
              <Pressable
                onPress={() => {
                  setDraft('');
                  setReplyTo(null);
                }}
                hitSlop={theme.layout.hitSlop}
                style={draft.trim() ? undefined : styles.disabled}
              >
                <Ionicons
                  name="send"
                  size={20}
                  color={draft.trim() ? theme.colors.brand : theme.colors.textMuted}
                />
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  comment: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  reply: { paddingHorizontal: 0, paddingRight: 0, marginTop: 8 },
  commentBody: { flex: 1 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 5 },
  commentLike: { alignItems: 'center', gap: 2, paddingTop: 2 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 40,
  },
  replyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 },
  disabled: { opacity: 0.4 },
});
