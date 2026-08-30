import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
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
  Badge,
} from '../../components';
import { useTheme } from '../../theme';
import { SourceNote } from '../../components/DataSource';
import { useCommunity } from '../../hooks/useCommunities';
import { communities as sampleCommunities, communityJoinRequests } from '../../mock';
import { formatCount, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function CommunityRequestsScreen({ navigation, route }: RootScreenProps<'CommunityRequests'>) {
  const theme = useTheme();
  const { communityId } = route.params;

  const detail = useCommunity(communityId);
  const sample = sampleCommunities.find((c) => c.id === communityId) ?? sampleCommunities[1];
  const community = detail.community ?? sample;
  const live = detail.community !== null;

  const [localRequests, setLocalRequests] = useState(communityJoinRequests);
  const [handled, setHandled] = useState<Record<string, 'approved' | 'rejected'>>({});

  // The server decides staff status; a client-side role check would be a
  // suggestion, and the queue endpoint would refuse anyway.
  const isStaff = community.myRole !== 'member';

  const requests = live
    ? detail.requests.map((r) => ({
        id: r.id,
        user: {
          id: r.user.id,
          username: r.user.username,
          displayName: r.user.displayName,
          avatar: r.user.avatar ?? `https://i.pravatar.cc/150?u=${r.user.username}`,
          accountCategory: r.user.accountCategory,
          accountType: r.user.accountType as (typeof localRequests)[number]['user']['accountType'],
          verification: r.user.verificationTier,
          followers: r.user.followers,
          following: r.user.following,
          likes: r.user.likes,
          videos: r.user.videos,
        },
        message: r.message ?? '',
        requestedAt: r.createdAt,
      }))
    : localRequests;

  const setRequests = setLocalRequests;

  const decide = (id: string, decision: 'approved' | 'rejected') => {
    if (live) {
      setHandled((prev) => ({ ...prev, [id]: decision }));
      void detail.decide(id, decision === 'approved');
      return;
    }
    setHandled((prev) => ({ ...prev, [id]: decision }));
    setTimeout(() => setRequests((prev) => prev.filter((r) => r.id !== id)), 700);
  };

  if (!isStaff) {
    return (
      <Screen>
        <Header title="Join requests" />
        <EmptyState
          icon="lock-closed-outline"
          title="Not available"
          description="Only the community owner, admins and moderators can review join requests."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Join requests" subtitle={community.name} />

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
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
              Approving adds the person immediately. Every decision is recorded in the community
              activity log.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="checkmark-done-outline"
            title="No pending requests"
            description="New requests to join this community will appear here."
          />
        }
        renderItem={({ item }) => {
          const decision = handled[item.id];
          return (
            <View
              style={[
                styles.row,
                { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
              ]}
            >
              <Pressable onPress={() => navigation.navigate('Profile', { userId: item.user.id })}>
                <Avatar uri={item.user.avatar} size={48} />
              </Pressable>

              <View style={styles.flex}>
                <NameWithBadge name={item.user.displayName} tier={item.user.verification} />
                <Text variant="caption" tone="muted">
                  @{item.user.username} · {formatCount(item.user.followers)} followers
                </Text>
                {item.message ? (
                  <Text variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>
                    "{item.message}"
                  </Text>
                ) : null}
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  Requested {timeAgo(item.requestedAt)}
                </Text>

                {decision ? (
                  <Badge
                    label={decision === 'approved' ? 'Approved' : 'Rejected'}
                    tone={decision === 'approved' ? 'success' : 'danger'}
                    size="sm"
                    style={{ marginTop: 8 }}
                  />
                ) : (
                  <View style={[styles.actions, { marginTop: theme.spacing.xs }]}>
                    <Button
                      label="Approve"
                      size="sm"
                      variant="primary"
                      onPress={() => decide(item.id, 'approved')}
                    />
                    <Button
                      label="Reject"
                      size="sm"
                      variant="outline"
                      onPress={() => decide(item.id, 'rejected')}
                    />
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: 8 },
});
