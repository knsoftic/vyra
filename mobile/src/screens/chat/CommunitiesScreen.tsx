import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  Badge,
  Button,
  Segmented,
  EmptyState,
  CountBadge,
  IconButton,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useCommunityList } from '../../hooks/useCommunities';
import { communities as sampleCommunities } from '../../mock';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function CommunitiesScreen({ navigation }: RootScreenProps<'Communities'>) {
  const theme = useTheme();
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');

  // "Mine" and "Discover" are different queries, not a filter over one list:
  // the server decides membership, and a client-side filter would be guessing.
  const mine = useCommunityList({ mine: true });
  const all = useCommunityList();
  const source = tab === 'mine' ? mine : all;

  const sample =
    tab === 'mine' ? sampleCommunities : sampleCommunities.filter((c) => !c.isPrivate);

  const isLive = source.live && source.communities.length > 0;
  const list = isLive ? source.communities : sample;

  return (
    <Screen>
      <Header title="Communities" right={<IconButton icon="add" size={22} />} />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'mine', label: 'My communities' },
            { id: 'discover', label: 'Discover' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <View style={{ paddingHorizontal: 0 }}>
        <SourceNote
          source={isLive ? 'live' : 'sample'}
          noun="communities"
          sampleHint={
            source.live
              ? tab === 'mine'
                ? 'you have not joined any yet — these are examples'
                : 'no communities exist yet — these are examples'
              : 'sign in to see real communities'
          }
        />
      </View>

      <FlatList
        data={list}
        refreshing={source.loading}
        onRefresh={() => void source.refresh()}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.sm }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No communities yet"
            description="Join a community to talk with people who make the same kind of thing you do."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('Community', { communityId: item.id })}
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg },
            ]}
          >
            {item.banner ? (
              <Image source={{ uri: item.banner }} style={styles.banner} contentFit="cover" />
            ) : null}

            <View style={[styles.cardBody, { padding: theme.spacing.md }]}>
              <Avatar uri={item.logo} size={52} />

              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                    {item.name}
                  </Text>
                  {item.isPrivate ? (
                    <Ionicons name="lock-closed" size={13} color={theme.colors.textMuted} />
                  ) : null}
                  <CountBadge count={item.unreadCount ?? 0} />
                </View>

                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {item.description}
                </Text>

                <View style={styles.metaRow}>
                  <Text variant="caption" tone="secondary">
                    {formatCount(item.memberCount)} members
                  </Text>
                  {item.myRole !== 'member' ? (
                    <Badge
                      label={item.myRole === 'owner' ? 'Owner' : item.myRole === 'admin' ? 'Admin' : 'Moderator'}
                      tone={item.myRole === 'owner' ? 'gold' : 'accent'}
                      size="sm"
                    />
                  ) : null}
                  {(item.pendingRequests ?? 0) > 0 && item.myRole !== 'member' ? (
                    <Badge label={`${item.pendingRequests} requests`} tone="warning" size="sm" />
                  ) : null}
                </View>
              </View>
            </View>

            {tab === 'discover' ? (
              <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }}>
                <Button label={item.isPrivate ? 'Request to join' : 'Join'} variant="secondary" fullWidth size="sm" />
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { overflow: 'hidden' },
  banner: { width: '100%', height: 84 },
  cardBody: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
});
