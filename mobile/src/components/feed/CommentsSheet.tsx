import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
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
import { engagement, type Comment } from '../../api/engagement';
import { ApiError } from '../../api';
import type { Video, VerificationTier } from '../../types';

/**
 * The comment sheet.
 *
 * Every comment here is real. It used to render the same list of sample
 * comments under every video, which made the whole comment section look busy
 * and meant nothing anyone typed was ever saved.
 *
 * Counts come back from the server after each action rather than being
 * incremented locally, so two people in the same thread see the same numbers.
 */
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
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [openThreads, setOpenThreads] = useState<Record<string, Comment[]>>({});

  const commentsDisabled = video ? !video.interaction.allowComments : false;

  const load = useCallback(async () => {
    if (!video || commentsDisabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await engagement.comments(video.id);
      setComments(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(
        err instanceof ApiError && !err.offline ? err.message : 'Could not load comments.',
      );
    } finally {
      setLoading(false);
    }
  }, [video, commentsDisabled]);

  useEffect(() => {
    if (visible) {
      setReplyTo(null);
      setOpenThreads({});
      void load();
    }
  }, [visible, load]);

  const send = async () => {
    const body = draft.trim();
    if (!video || !body || sending) return;

    setSending(true);
    setError(null);
    try {
      const created = await engagement.addComment(video.id, body, replyTo?.id);
      setDraft('');

      if (replyTo) {
        // Slot the reply into its open thread and bump the parent's count.
        setOpenThreads((prev) => ({
          ...prev,
          [replyTo.id]: [...(prev[replyTo.id] ?? []), created],
        }));
        setComments((prev) =>
          prev.map((c) => (c.id === replyTo.id ? { ...c, replyCount: c.replyCount + 1 } : c)),
        );
        setReplyTo(null);
      } else {
        setComments((prev) => [created, ...prev]);
      }
      setTotal((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post that comment.');
    } finally {
      setSending(false);
    }
  };

  const toggleLike = async (comment: Comment) => {
    // Optimistic: a heart that waits on a round trip feels broken. Put it back
    // if the server disagrees.
    const apply = (liked: boolean, delta: number) => {
      const patch = (c: Comment) =>
        c.id === comment.id ? { ...c, liked, likeCount: Math.max(0, c.likeCount + delta) } : c;
      setComments((prev) => prev.map(patch));
      setOpenThreads((prev) =>
        Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.map(patch)])),
      );
    };

    apply(!comment.liked, comment.liked ? -1 : 1);
    try {
      const result = comment.liked
        ? await engagement.unlikeComment(comment.id)
        : await engagement.likeComment(comment.id);
      // Settle on the server's number.
      const settle = (c: Comment) =>
        c.id === comment.id ? { ...c, liked: result.liked, likeCount: result.likeCount } : c;
      setComments((prev) => prev.map(settle));
      setOpenThreads((prev) =>
        Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.map(settle)])),
      );
    } catch {
      apply(comment.liked, comment.liked ? 1 : -1);
    }
  };

  const openReplies = async (comment: Comment) => {
    if (openThreads[comment.id]) {
      setOpenThreads((prev) => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
      return;
    }
    try {
      const replies = await engagement.replies(comment.id);
      setOpenThreads((prev) => ({ ...prev, [comment.id]: replies }));
    } catch {
      setError('Could not load the replies.');
    }
  };

  const remove = (comment: Comment) => {
    Alert.alert('Delete comment', 'This cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void engagement
            .deleteComment(comment.id)
            .then(() => {
              setComments((prev) => prev.filter((c) => c.id !== comment.id));
              setTotal((prev) => Math.max(0, prev - 1 - comment.replyCount));
            })
            .catch(() => setError('Could not delete that comment.'));
        },
      },
    ]);
  };

  const renderComment = (comment: Comment, isReply = false) => (
    <View key={comment.id} style={[styles.comment, isReply && styles.reply]}>
      <Avatar uri={comment.author.avatar ?? undefined} size={isReply ? 28 : 36} />

      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <NameWithBadge
            name={comment.author.displayName}
            tier={comment.author.verificationTier as VerificationTier}
            variant="label"
            tone="secondary"
            size={12}
          />
          {comment.isAuthor ? <Badge label="Creator" tone="brand" size="sm" /> : null}
          {comment.isPinned ? <Badge label="Pinned" tone="neutral" size="sm" /> : null}
        </View>

        <Text variant="body" style={{ marginTop: 2 }}>
          {comment.body}
        </Text>

        <View style={styles.commentMeta}>
          <Text variant="caption" tone="muted">
            {timeAgo(comment.createdAt)}
          </Text>
          {!isReply ? (
            <Pressable onPress={() => setReplyTo(comment)} hitSlop={theme.layout.hitSlop}>
              <Text variant="caption" tone="muted">
                Reply
              </Text>
            </Pressable>
          ) : null}
          {comment.canDelete ? (
            <Pressable onPress={() => remove(comment)} hitSlop={theme.layout.hitSlop}>
              <Text variant="caption" tone="muted">
                Delete
              </Text>
            </Pressable>
          ) : null}
          {comment.replyCount > 0 && !isReply ? (
            <Pressable onPress={() => void openReplies(comment)} hitSlop={theme.layout.hitSlop}>
              <Text variant="caption" tone="brand">
                {openThreads[comment.id] ? 'Hide replies' : `View ${comment.replyCount} replies`}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {openThreads[comment.id]?.map((reply) => renderComment(reply, true))}
      </View>

      <Pressable
        onPress={() => void toggleLike(comment)}
        hitSlop={theme.layout.hitSlop}
        style={styles.commentLike}
      >
        <Ionicons
          name={comment.liked ? 'heart' : 'heart-outline'}
          size={16}
          color={comment.liked ? theme.colors.brand : theme.colors.textMuted}
        />
        <Text variant="caption" tone="muted">
          {formatCount(comment.likeCount)}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`${formatCount(total)} ${total === 1 ? 'comment' : 'comments'}`}
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
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : (
          <FlatList
            data={comments}
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

        {error ? (
          <View style={[styles.error, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
            <Text variant="caption" style={{ color: theme.colors.danger, flex: 1 }}>
              {error}
            </Text>
          </View>
        ) : null}

        {!commentsDisabled ? (
          <View>
            {replyTo ? (
              <View style={[styles.replyBar, { borderTopColor: theme.colors.border }]}>
                <Text variant="caption" tone="muted" style={styles.flex}>
                  Replying to {replyTo.author.displayName}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={theme.layout.hitSlop}>
                  <Ionicons name="close" size={16} color={theme.colors.textMuted} />
                </Pressable>
              </View>
            ) : null}

            <View
              style={[
                styles.composer,
                {
                  borderTopColor: theme.colors.border,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                },
              ]}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
                placeholderTextColor={theme.colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    color: theme.colors.text,
                    borderRadius: theme.radius.pill,
                  },
                ]}
                maxLength={1000}
                editable={!sending}
                onSubmitEditing={() => void send()}
              />
              <Pressable
                onPress={() => void send()}
                disabled={!draft.trim() || sending}
                hitSlop={theme.layout.hitSlop}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={theme.colors.brand} />
                ) : (
                  <Ionicons
                    name="send"
                    size={20}
                    color={draft.trim() ? theme.colors.brand : theme.colors.textMuted}
                  />
                )}
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  comment: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  reply: { paddingLeft: 46, paddingRight: 0 },
  commentBody: { flex: 1 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  commentLike: { alignItems: 'center', gap: 2, paddingTop: 2 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14 },
  error: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, marginHorizontal: 16, borderRadius: 8 },
});
