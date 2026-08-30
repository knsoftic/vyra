import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  AvatarGroup,
  NameWithBadge,
  Segmented,
  EmptyState,
  IconButton,
  Divider,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { calls as callsApi } from '../../api';
import { callHistory } from '../../mock';
import { formatDuration, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function CallHistoryScreen({ navigation }: RootScreenProps<'CallHistory'>) {
  const theme = useTheme();
  const [filter, setFilter] = useState<'all' | 'missed'>('all');

  const { data: live, source } = useApiData(
    () =>
      callsApi.history().then((rows) =>
        rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          // The server reports outcome and direction separately; the UI has one
          // field, and "missed" is the more useful thing to show when both apply.
          direction: (r.state === 'missed' || r.state === 'declined'
            ? 'missed'
            : r.outgoing
              ? 'outgoing'
              : 'incoming') as (typeof callHistory)[number]['direction'],
          participants: r.peers.map((p) => ({
            id: p.id,
            username: p.username,
            displayName: p.displayName,
            avatar: p.avatar ?? `https://i.pravatar.cc/150?u=${p.username}`,
            accountCategory: p.accountCategory,
            accountType: p.accountType as (typeof callHistory)[number]['participants'][number]['accountType'],
            verification: p.verificationTier,
            followers: p.followers,
            following: p.following,
            likes: p.likes,
            videos: p.videos,
          })),
          isGroup: r.isGroup,
          startedAt: r.startedAt ?? r.createdAt,
          durationSec: r.durationSec,
        })),
      ),
    callHistory,
    [],
  );

  const history = source === 'live' ? live : callHistory;
  const list = filter === 'missed' ? history.filter((c) => c.direction === 'missed') : history;

  return (
    <Screen>
      <Header title="Calls" right={<IconButton icon="add-circle-outline" size={22} />} />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'all', label: 'All' },
            { id: 'missed', label: 'Missed' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <SourceNote
        source={source}
        noun="call history"
        sampleHint="you have not made any calls yet"
      />

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <Divider inset={76} />}
        ListEmptyComponent={
          <EmptyState
            icon="call-outline"
            title={filter === 'missed' ? 'No missed calls' : 'No calls yet'}
            description="Voice and video calls with people you message appear here."
          />
        }
        renderItem={({ item }) => {
          const missed = item.direction === 'missed';
          const primary = item.participants[0];
          const directionIcon =
            item.direction === 'incoming'
              ? 'arrow-down-outline'
              : item.direction === 'outgoing'
                ? 'arrow-up-outline'
                : 'close-outline';

          return (
            <Pressable
              onPress={() =>
                item.isGroup
                  ? navigation.navigate('GroupCall', {})
                  : navigation.navigate(item.kind === 'video' ? 'VideoCall' : 'VoiceCall', {
                      userId: primary.id,
                    })
              }
              style={[
                styles.row,
                { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
              ]}
            >
              {item.isGroup ? (
                <AvatarGroup uris={item.participants.map((p) => p.avatar)} size={40} max={2} />
              ) : (
                <Avatar uri={primary.avatar} size={48} />
              )}

              <View style={styles.flex}>
                <NameWithBadge
                  name={
                    item.isGroup
                      ? item.participants.map((p) => p.displayName.split(' ')[0]).join(', ')
                      : primary.displayName
                  }
                  tier={item.isGroup ? 'none' : primary.verification}
                  tone={missed ? 'danger' : 'primary'}
                />
                <View style={styles.metaRow}>
                  <Ionicons
                    name={directionIcon}
                    size={13}
                    color={missed ? theme.colors.danger : theme.colors.textMuted}
                  />
                  <Text variant="caption" tone="muted">
                    {timeAgo(item.startedAt)}
                    {item.durationSec > 0 ? ` · ${formatDuration(item.durationSec)}` : ''}
                  </Text>
                </View>
              </View>

              <IconButton
                icon={item.kind === 'video' ? 'videocam-outline' : 'call-outline'}
                size={21}
                onPress={() =>
                  item.isGroup
                    ? navigation.navigate('GroupCall', {})
                    : navigation.navigate(item.kind === 'video' ? 'VideoCall' : 'VoiceCall', {
                        userId: primary.id,
                      })
                }
              />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
});
