import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Sheet, SheetActionRow } from '../Sheet';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Avatar } from '../Avatar';
import { Divider } from '../Lists';
import { useTheme } from '../../theme';
import { chats } from '../../mock';
import { Video } from '../../types';

/**
 * Share sheet doubles as the video action menu: sharing targets on top,
 * then the negative-signal actions the recommendation engine listens to.
 */
export function ShareSheet({
  video,
  visible,
  onClose,
}: {
  video: Video | null;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const navigation = useNavigation();

  const externalTargets = [
    { id: 'copy', label: 'Copy link', icon: 'link-outline' as const },
    { id: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' as const, color: '#25D366' },
    { id: 'instagram', label: 'Instagram', icon: 'logo-instagram' as const, color: '#E1306C' },
    { id: 'x', label: 'X', icon: 'logo-twitter' as const },
    { id: 'facebook', label: 'Facebook', icon: 'logo-facebook' as const, color: '#1877F2' },
    { id: 'more', label: 'More', icon: 'ellipsis-horizontal' as const },
  ];

  const utilityActions = [
    { id: 'save', label: 'Save video', icon: 'bookmark-outline' as const },
    { id: 'duet', label: 'Duet', icon: 'people-outline' as const, disabled: !video?.interaction.allowDuet },
    { id: 'remix', label: 'Remix', icon: 'git-branch-outline' as const, disabled: !video?.interaction.allowRemix },
    { id: 'download', label: 'Download', icon: 'download-outline' as const, disabled: !video?.interaction.allowDownload },
    { id: 'sound', label: 'Use sound', icon: 'musical-notes-outline' as const },
    { id: 'promote', label: 'Promote', icon: 'trending-up-outline' as const },
  ];

  /** These three feed the negative-signal pipeline described in PHASE_06. */
  const feedbackActions = [
    { id: 'not_interested', label: 'Not interested', icon: 'hand-left-outline' as const, description: 'Show me fewer videos like this' },
    { id: 'hide_creator', label: 'Hide this creator', icon: 'eye-off-outline' as const, description: 'Stop showing videos from @' + (video?.author.username ?? '') },
    { id: 'report', label: 'Report', icon: 'flag-outline' as const, danger: true },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} height={0.62}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }}
        >
          SEND TO
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.md, paddingVertical: theme.spacing.sm }}
        >
          {chats.slice(0, 6).map((chat) => (
            <Pressable
              key={chat.id}
              onPress={() => {
                onClose();
                navigation.navigate(chat.kind === 'group' ? 'GroupChat' : 'PrivateChat', {
                  chatId: chat.id,
                });
              }}
              style={styles.person}
            >
              <Avatar uri={chat.avatar} size={52} />
              <Text variant="caption" tone="secondary" numberOfLines={1} align="center">
                {chat.title.split(' ')[0]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Divider />

        <SheetActionRow
          actions={externalTargets.map((target) => ({
            id: target.id,
            label: target.label,
            icon: target.icon,
            color: target.color,
          }))}
        />

        <Divider />

        <View style={{ paddingVertical: theme.spacing.xs }}>
          {utilityActions.map((action) => (
            <Pressable
              key={action.id}
              onPress={
                action.id === 'promote'
                  ? () => {
                      onClose();
                      navigation.navigate('Promotion', { videoId: video?.id });
                    }
                  : undefined
              }
              style={[
                styles.row,
                { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
                action.disabled && styles.disabled,
              ]}
            >
              <Ionicons name={action.icon} size={20} color={theme.colors.text} />
              <Text variant="body" style={styles.flex}>
                {action.label}
              </Text>
              {action.disabled ? (
                <Text variant="caption" tone="muted">
                  Off
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>

        <Divider />

        <View style={{ paddingVertical: theme.spacing.xs, paddingBottom: theme.spacing.xl }}>
          {feedbackActions.map((action) => (
            <Pressable
              key={action.id}
              onPress={onClose}
              style={[
                styles.row,
                { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
              ]}
            >
              <Ionicons
                name={action.icon}
                size={20}
                color={action.danger ? theme.colors.danger : theme.colors.text}
              />
              <View style={styles.flex}>
                <Text variant="body" tone={action.danger ? 'danger' : 'primary'}>
                  {action.label}
                </Text>
                {action.description ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {action.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  person: { alignItems: 'center', gap: 6, width: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  disabled: { opacity: 0.4 },
});
