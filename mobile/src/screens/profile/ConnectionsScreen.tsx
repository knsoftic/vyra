import React, { useState } from 'react';
import { View, StyleSheet, FlatList, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  NameWithBadge,
  Button,
  EmptyState,
  TopTabs,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { followers, following, getUser, suggestedUsers } from '../../mock';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import { useApiData } from '../../hooks/useApiData';
import { graph, users as usersApi, toUser } from '../../api';
import type { RootScreenProps } from '../../navigation/types';
import type { User } from '../../types';

function ConnectionList({
  userId,
  initialTab,
  navigation,
}: {
  userId: string;
  initialTab: 'followers' | 'following';
  navigation: RootScreenProps<'Followers'>['navigation'];
}) {
  const theme = useTheme();
  const { isFollowing, toggleFollow, user: me } = useApp();
  const { user: sessionUser } = useSession();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');

  // Both directions come from the same paged endpoint, so the tab is a
  // dependency rather than two separate hooks.
  const { data: liveList, source, refresh } = useApiData(
    () => (tab === 'followers' ? graph.followers(userId) : graph.following(userId)),
    [],
    [tab, userId],
  );

  const mockTarget = userId === me.id ? me : getUser(userId);
  // When the signed-in user is looking at their own lists, the counts in the
  // tab labels should be the server's, not the sample profile's.
  const target =
    sessionUser && (userId === sessionUser.id || userId === me.id)
      ? { ...mockTarget, username: sessionUser.username,
          followers: sessionUser.followers, following: sessionUser.following }
      : mockTarget;

  const base: User[] =
    source === 'live' ? liveList.map(toUser) : tab === 'followers' ? followers : following;

  const list = query
    ? base.filter(
        (u) =>
          u.username.toLowerCase().includes(query.toLowerCase()) ||
          u.displayName.toLowerCase().includes(query.toLowerCase()),
      )
    : base;

  /**
   * Following is a server fact when the list is live: writing it only into local
   * state would show a follow that the next refresh silently undoes.
   */
  const onToggleFollow = async (item: User) => {
    if (source === 'live') {
      const wasFollowing = item.isFollowing ?? isFollowing(item);
      try {
        await (wasFollowing ? usersApi.unfollow(item.id) : usersApi.follow(item.id));
      } catch {
        // Leave the list as it was; a refresh will show the true state.
      }
      await refresh();
      return;
    }
    toggleFollow(item.id);
  };

  const renderUser = ({ item }: { item: User }) => {
    const followingThem = source === 'live' ? (item.isFollowing ?? false) : isFollowing(item);
    return (
      <Pressable
        onPress={() => navigation.navigate('Profile', { userId: item.id })}
        style={[styles.row, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }]}
      >
        <Avatar uri={item.avatar} size={48} live={item.isLive} />
        <View style={styles.flex}>
          <NameWithBadge name={item.displayName} tier={item.verification} />
          <Text variant="caption" tone="muted" numberOfLines={1}>
            @{item.username} · {formatCount(item.followers)} followers
          </Text>
        </View>
        <Button
          label={followingThem ? 'Following' : item.isFollowedBy ? 'Follow back' : 'Follow'}
          variant={followingThem ? 'secondary' : 'primary'}
          size="sm"
          onPress={() => void onToggleFollow(item)}
        />
      </Pressable>
    );
  };

  return (
    <Screen>
      <Header title={`@${target.username}`} />

      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }}>
        <TopTabs
          tabs={[
            { id: 'followers', label: `${formatCount(target.followers)} Followers` },
            { id: 'following', label: `${formatCount(target.following)} Following` },
          ]}
          value={tab}
          onChange={setTab}
          centered
        />
      </View>

      <View style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="search" size={16} color={theme.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.colors.textMuted}
            style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}
          />
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <SourceNote
            source={source}
            noun={tab}
            sampleHint="sign in with a live backend to see the real graph"
          />
        }
        ListFooterComponent={
          source !== 'live' && tab === 'followers' && !query ? (
            <View style={{ paddingTop: theme.spacing.lg }}>
              <Text variant="labelStrong" tone="muted" style={{ paddingHorizontal: theme.spacing.md }}>
                SUGGESTED FOR YOU
              </Text>
              {suggestedUsers.map((item) => (
                <View key={item.id}>{renderUser({ item })}</View>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
            description={
              query
                ? `Nothing matched "${query}".`
                : tab === 'following'
                  ? 'Follow creators to fill your Following feed.'
                  : undefined
            }
          />
        }
      />
    </Screen>
  );
}

export function FollowersScreen({ navigation, route }: RootScreenProps<'Followers'>) {
  return <ConnectionList userId={route.params.userId} initialTab="followers" navigation={navigation} />;
}

export function FollowingScreen({ navigation, route }: RootScreenProps<'Following'>) {
  return (
    <ConnectionList
      userId={route.params.userId}
      initialTab="following"
      navigation={navigation as unknown as RootScreenProps<'Followers'>['navigation']}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12 },
});
