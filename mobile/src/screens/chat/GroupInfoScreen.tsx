import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  NameWithBadge,
  Badge,
  Card,
  ListRow,
  Divider,
  Toggle,
  IconButton,
  SectionHeader,
} from '../../components';
import { useTheme } from '../../theme';
import { chats, groups, currentUser } from '../../mock';
import type { RootScreenProps } from '../../navigation/types';

export function GroupInfoScreen({ navigation, route }: RootScreenProps<'GroupInfo'>) {
  const theme = useTheme();
  const { chatId } = route.params;

  const chat = chats.find((c) => c.id === chatId) ?? chats[2];
  const group = groups.find((g) => g.id === chatId) ?? groups[0];
  const [muted, setMuted] = useState(chat.isMuted ?? false);

  const isOwner = group.ownerId === currentUser.id;

  const sharedCounts = [
    { id: 'media', label: 'Media', icon: 'images-outline' as const, count: 128 },
    { id: 'videos', label: 'Videos', icon: 'videocam-outline' as const, count: 34 },
    { id: 'docs', label: 'Documents', icon: 'document-outline' as const, count: 12 },
    { id: 'voice', label: 'Voice notes', icon: 'mic-outline' as const, count: 46 },
    { id: 'links', label: 'Links', icon: 'link-outline' as const, count: 21 },
  ];

  return (
    <Screen>
      <Header title="Group info" right={isOwner ? <IconButton icon="create-outline" size={20} /> : null} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Identity */}
        <View style={[styles.identity, { padding: theme.spacing.lg }]}>
          <Avatar uri={chat.avatar} size={92} />
          <Text variant="h2" align="center" style={{ marginTop: theme.spacing.sm }}>
            {chat.title}
          </Text>
          <Text variant="caption" tone="muted">
            Group · {group.memberCount} members
          </Text>
          <Text variant="body" tone="secondary" align="center" style={{ marginTop: theme.spacing.sm }}>
            {group.description}
          </Text>
        </View>

        {/* Quick actions */}
        <View style={[styles.actions, { paddingHorizontal: theme.spacing.md }]}>
          {[
            { id: 'call', label: 'Voice', icon: 'call-outline' as const, onPress: () => navigation.navigate('GroupCall', { chatId }) },
            { id: 'video', label: 'Video', icon: 'videocam-outline' as const, onPress: () => navigation.navigate('GroupCall', { chatId }) },
            { id: 'add', label: 'Invite', icon: 'person-add-outline' as const },
            { id: 'search', label: 'Search', icon: 'search-outline' as const },
          ].map((action) => (
            <Pressable key={action.id} onPress={action.onPress} style={styles.action}>
              <View
                style={[
                  styles.actionIcon,
                  { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
                ]}
              >
                <Ionicons name={action.icon} size={20} color={theme.colors.text} />
              </View>
              <Text variant="caption" tone="secondary">
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Shared content */}
        <SectionHeader title="Shared content" />
        <Card>
          {sharedCounts.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider inset={60} /> : null}
              <ListRow label={item.label} icon={item.icon} value={String(item.count)} onPress={() => {}} />
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
          <ListRow label="Pinned message" icon="pin-outline" onPress={() => {}} />
          {isOwner ? (
            <>
              <Divider inset={60} />
              <ListRow label="Who can send messages" icon="chatbox-outline" value="All members" onPress={() => {}} />
              <Divider inset={60} />
              <ListRow label="Who can add members" icon="person-add-outline" value="Admins" onPress={() => {}} />
            </>
          ) : null}
        </Card>

        {/* Members — groups show the full roster, unlike communities */}
        <SectionHeader title={`${group.memberCount} members`} action="Add" />
        <Card>
          {chat.participants.map((member, index) => {
            const isGroupOwner = member.id === group.ownerId;
            const isAdmin = group.adminIds.includes(member.id);
            return (
              <View key={member.id}>
                {index > 0 ? <Divider inset={72} /> : null}
                <ListRow
                  label={member.displayName}
                  description={`@${member.username}`}
                  left={<Avatar uri={member.avatar} size={44} />}
                  onPress={() => navigation.navigate('Profile', { userId: member.id })}
                  showChevron={false}
                  right={
                    isGroupOwner ? (
                      <Badge label="Owner" tone="gold" size="sm" />
                    ) : isAdmin ? (
                      <Badge label="Admin" tone="accent" size="sm" />
                    ) : null
                  }
                />
              </View>
            );
          })}
        </Card>

        {/* Danger zone */}
        <Card style={{ marginTop: theme.spacing.lg }}>
          <ListRow label="Report group" icon="flag-outline" danger onPress={() => {}} />
          <Divider inset={60} />
          <ListRow label="Leave group" icon="exit-outline" danger onPress={() => navigation.goBack()} />
          {isOwner ? (
            <>
              <Divider inset={60} />
              <ListRow label="Delete group" icon="trash-outline" danger onPress={() => {}} />
            </>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: 6 },
  actionIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
});
