import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { Avatar, VerifiedBadge } from '../Avatar';
import { useTheme } from '../../theme';
import { liveComments as seedComments } from '../../mock';
import type { LiveComment } from '../../types';

/**
 * Scrolling live chat. New comments arrive on a timer to show the real feel of a
 * busy stream; Phase 9 replaces the timer with the Socket.IO event stream.
 */
export function LiveCommentStream({
  height = 220,
  comments: supplied,
}: {
  height?: number;
  /**
   * Real comments from the stream. When absent — no backend — the component
   * replays a sample conversation on a timer so the screen is not empty.
   *
   * That replay is a placeholder, not a simulation of activity: the moment real
   * comments arrive it stops entirely, because a live screen showing invented
   * chatter alongside real chatter is worse than one showing neither.
   */
  comments?: LiveComment[];
}) {
  const theme = useTheme();
  const [sample, setComments] = useState<LiveComment[]>(seedComments.slice(0, 6));
  const listRef = useRef<FlatList<LiveComment>>(null);
  const cursor = useRef(6);

  const comments = supplied ?? sample;

  useEffect(() => {
    if (supplied) return;
    const interval = setInterval(() => {
      const next = seedComments[cursor.current % seedComments.length];
      cursor.current += 1;
      setComments((prev) => [
        ...prev.slice(-24),
        { ...next, id: `${next.id}_${cursor.current}`, createdAt: new Date().toISOString() },
      ]);
    }, 2600);
    return () => clearInterval(interval);
  }, [supplied]);

  return (
    <View style={{ height }}>
      <FlatList
        ref={listRef}
        data={comments}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.kind === 'join' || item.kind === 'follow') {
            return (
              <View style={[styles.systemRow, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                <Text variant="caption" tone="onDark">
                  {item.author.displayName}{' '}
                  {item.kind === 'join' ? 'joined' : 'started following'}
                </Text>
              </View>
            );
          }

          if (item.kind === 'gift') {
            return (
              <View style={[styles.giftRow, { backgroundColor: theme.colors.brand }]}>
                <Ionicons name="gift" size={13} color="#FFF" />
                <Text variant="caption" tone="onDark" numberOfLines={1}>
                  {item.author.displayName} sent {item.giftName}
                </Text>
              </View>
            );
          }

          return (
            <View style={styles.row}>
              <Avatar uri={item.author.avatar} size={24} />
              <View style={styles.bubble}>
                <View style={styles.nameRow}>
                  <Text variant="caption" style={styles.name}>
                    {item.author.displayName}
                  </Text>
                  <VerifiedBadge tier={item.author.verification} size={10} />
                </View>
                <Text variant="label" tone="onDark">
                  {item.text}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6, paddingHorizontal: 12, justifyContent: 'flex-end', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, maxWidth: '86%' },
  bubble: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { color: 'rgba(255,255,255,0.65)' },
  systemRow: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  giftRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
});
