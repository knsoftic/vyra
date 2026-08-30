import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  Badge,
  Card,
  ListRow,
  Divider,
  Toggle,
  SectionHeader,
  Button,
  EmptyState,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useCommunity, toMemberUser } from '../../hooks/useCommunities';
import { communities as sampleCommunities } from '../../mock';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function CommunityInfoScreen({ navigation, route }: RootScreenProps<'CommunityInfo'>) {
  const theme = useTheme();
  const { communityId } = route.params;

  // Live detail, including the roster the server is willing to show us.
  const detail = useCommunity(communityId);

  const sample =
    sampleCommunities.find((c) => c.id === communityId) ?? sampleCommunities[0];
  const community = detail.community ?? sample;
  const live = detail.community !== null;

  /**
   * ADR-014 in the interface.
   *
   * `restricted` means the server gave us staff only. Showing that list under a
   * heading of "members" would tell the viewer this community has four people
   * in it, so the heading and the note both change.
   */
  const roster = live ? detail.members.map(toMemberUser) : (sample.members ?? []);
  const rosterIsStaffOnly = live && detail.restricted;
  const [muted, setMuted] = useState(false);

  /**
   * ADR-014: only owner / admin / moderator may see the member roster,
   * join requests, reports and blocked users. Ordinary members see the count only.
   */
  const isStaff = community.myRole !== 'member';

  const permissionRows = [
    { id: 'canPost', label: 'Post messages', value: community.permissions.canPost },
    { id: 'canComment', label: 'Comment', value: community.permissions.canComment },
    { id: 'canSendMedia', label: 'Send photos and videos', value: community.permissions.canSendMedia },
    { id: 'canSendLinks', label: 'Send links', value: community.permissions.canSendLinks },
    { id: 'canInvite', label: 'Invite people', value: community.permissions.canInvite },
  ];

  return (
    <Screen>
      <Header
        title="Community info"
        right={
          isStaff ? (
            <Pressable hitSlop={theme.layout.hitSlop}>
              <Text variant="label" tone="brand">
                Edit
              </Text>
            </Pressable>
          ) : null
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {community.banner ? (
          <Image source={{ uri: community.banner }} style={styles.banner} contentFit="cover" />
        ) : null}

        <View style={[styles.identity, { padding: theme.spacing.lg }]}>
          <Avatar uri={community.logo} size={88} />
          <Text variant="h2" align="center" style={{ marginTop: theme.spacing.sm }}>
            {community.name}
          </Text>

          <View style={styles.metaRow}>
            <Badge
              label={community.isPrivate ? 'Private' : 'Public'}
              tone={community.isPrivate ? 'neutral' : 'success'}
              size="sm"
            />
            <Text variant="caption" tone="muted">
              {formatCount(community.memberCount)} members
            </Text>
            {community.myRole !== 'member' ? (
              <Badge
                label={
                  community.myRole === 'owner'
                    ? 'You are the owner'
                    : community.myRole === 'admin'
                      ? 'You are an admin'
                      : 'You are a moderator'
                }
                tone="gold"
                size="sm"
              />
            ) : null}
          </View>

          <Text variant="body" tone="secondary" align="center" style={{ marginTop: theme.spacing.sm }}>
            {community.description}
          </Text>
        </View>

        {/* Rules */}
        <SectionHeader title="Rules" />
        <Card>
          {community.rules.map((rule, index) => (
            <View key={rule}>
              {index > 0 ? <Divider inset={48} /> : null}
              <View style={[styles.ruleRow, { padding: theme.spacing.md }]}>
                <View style={[styles.ruleNumber, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <Text variant="caption" tone="secondary">
                    {index + 1}
                  </Text>
                </View>
                <Text variant="body" style={styles.flex}>
                  {rule}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Your permissions */}
        <SectionHeader title="What you can do here" />
        <Card>
          {permissionRows.map((row, index) => (
            <View key={row.id}>
              {index > 0 ? <Divider inset={48} /> : null}
              <View style={[styles.permissionRow, { padding: theme.spacing.md }]}>
                <Ionicons
                  name={row.value ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={row.value ? theme.colors.success : theme.colors.textMuted}
                />
                <Text variant="body" tone={row.value ? 'primary' : 'muted'} style={styles.flex}>
                  {row.label}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Settings */}
        <SectionHeader title="Settings" />
        <Card>
          <ListRow
            label="Mute notifications"
            icon="notifications-off-outline"
            showChevron={false}
            right={<Toggle value={muted} onValueChange={setMuted} />}
          />
          <Divider inset={60} />
          <ListRow label="Shared media" icon="images-outline" onPress={() => {}} />
        </Card>

        {/* Staff-only management */}
        {isStaff ? (
          <>
            <SectionHeader title="Management" />
            <Card>
              <ListRow
                label="Members"
                description="View and manage everyone in this community"
                icon="people-outline"
                value={formatCount(community.memberCount)}
                onPress={() => {}}
              />
              <Divider inset={60} />
              <ListRow
                label="Join requests"
                icon="person-add-outline"
                value={String(community.pendingRequests ?? 0)}
                onPress={() => navigation.navigate('CommunityRequests', { communityId: community.id })}
              />
              <Divider inset={60} />
              {/*
                * Community-scoped reports and blocks have no backend yet, so
                * these say so rather than showing a count nobody measured.
                */}
              <ListRow
                label="Reports"
                icon="flag-outline"
                description="Community moderation queue arrives with Phase 12"
                showChevron={false}
              />
              <Divider inset={60} />
              <ListRow
                label="Member permissions"
                icon="key-outline"
                description="Who can post, comment and invite"
                onPress={() => {}}
              />
            </Card>

            {/* Roster — narrowed for non-staff (ADR-014) */}
            <SectionHeader
              title={rosterIsStaffOnly ? 'Moderators' : 'Moderators and members'}
            />
            {rosterIsStaffOnly ? (
              <Text
                variant="caption"
                tone="muted"
                style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs }}
              >
                {formatCount(community.memberCount)} people are in this community. The full
                member list is only visible to its moderators.
              </Text>
            ) : null}
            <Card>
              {roster.slice(0, 6).map((member, index) => (
                <View key={member.id}>
                  {index > 0 ? <Divider inset={72} /> : null}
                  <ListRow
                    label={member.displayName}
                    description={`@${member.username}`}
                    left={<Avatar uri={member.avatar} size={44} />}
                    onPress={() => navigation.navigate('Profile', { userId: member.id })}
                    showChevron={false}
                    right={index === 0 ? <Badge label="Owner" tone="gold" size="sm" /> : null}
                  />
                </View>
              ))}
            </Card>
          </>
        ) : (
          <>
            <SectionHeader title="Members" />
            <Card padded>
              <EmptyState
                icon="lock-closed-outline"
                title="Member list is private"
                description="This community shows the member count but not the member list. Only the owner, admins and moderators can see who is in it."
                compact
              />
            </Card>
          </>
        )}

        {/* Leave */}
        <Card style={{ marginTop: theme.spacing.lg }}>
          <ListRow label="Report community" icon="flag-outline" danger onPress={() => {}} />
          <Divider inset={60} />
          <ListRow
            label={community.myRole === 'owner' ? 'Transfer ownership to leave' : 'Leave community'}
            icon="exit-outline"
            danger
            // Leaving is a server fact. Navigating back without it would look
            // like it worked until the community reappeared on the next load.
            onPress={() => {
              if (community.myRole === 'owner') return;
              if (live) void detail.leave().then(() => navigation.goBack());
              else navigation.goBack();
            }}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { width: '100%', height: 120 },
  identity: { alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ruleNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
