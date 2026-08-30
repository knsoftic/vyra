import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Avatar,
  NameWithBadge,
  Button,
  EmptyState,
  Divider,
} from '../../components';
import { useTheme } from '../../theme';
import { blockedUsers as seed } from '../../mock';
import { useApiData } from '../../hooks/useApiData';
import { graph } from '../../api';
import type { User } from '../../types';
import type { RootScreenProps } from '../../navigation/types';

export function BlockedUsersScreen({}: RootScreenProps<'BlockedUsers'>) {
  const theme = useTheme();
  // Blocking is enforced server-side (it hides content in both directions), so
  // the list has to come from there rather than from local state.
  const { data: liveBlocked, source, refresh } = useApiData(() => graph.blocked(), [], []);
  const [localBlocked, setLocalBlocked] = useState(seed);

  // The row renders a full User, so the server fields are merged over a neutral
  // base. Anything the blocked-list endpoint does not return (follower counts,
  // account type) is not needed here and stays at its default rather than being
  // invented.
  const blocked: User[] =
    source === 'live'
      ? liveBlocked.map((b) => ({
          id: b.id,
          username: b.username,
          displayName: b.displayName,
          avatar: b.avatar ?? `https://i.pravatar.cc/150?u=${b.username}`,
          bio: '',
          accountCategory: 'individual',
          accountType: 'normal',
          verification: 'none',
          followers: 0,
          following: 0,
          likes: 0,
          videos: 0,
        }))
      : localBlocked;

  const setBlocked = setLocalBlocked;
  void setBlocked;

  const unblock = async (userId: string) => {
    if (source === 'live') {
      await graph.unblock(userId).catch(() => undefined);
      await refresh();
      return;
    }
    setLocalBlocked((prev) => prev.filter((u) => u.id !== userId));
  };

  return (
    <Screen>
      <Header title="Blocked users" subtitle={`${blocked.length} blocked`} />

      <FlatList
        data={blocked}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <Divider inset={76} />}
        ListHeaderComponent={
          <View
            style={[
              styles.notice,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                margin: theme.spacing.md,
                padding: theme.spacing.sm,
              },
            ]}
          >
            <Ionicons name="information-circle-outline" size={15} color={theme.colors.info} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Blocked people cannot message you, see your videos, or find your profile. They are
              not told that you blocked them.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="ban-outline"
            title="Nobody is blocked"
            description="People you block will be listed here so you can unblock them later."
          />
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
            ]}
          >
            <Avatar uri={item.avatar} size={48} />
            <View style={styles.flex}>
              <NameWithBadge name={item.displayName} tier={item.verification} />
              <Text variant="caption" tone="muted">
                @{item.username}
              </Text>
            </View>
            <Button
              label="Unblock"
              variant="secondary"
              size="sm"
              onPress={() => setBlocked((prev) => prev.filter((u) => u.id !== item.id))}
            />
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
