import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  ListRow,
  Toggle,
  Divider,
  Badge,
} from '../../components';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';
import type { VideoPrivacy } from '../../types';

const privacyOptions: { id: VideoPrivacy; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'public', label: 'Public', description: 'Anyone can see this video', icon: 'earth-outline' },
  { id: 'followers', label: 'Followers', description: 'Only people who follow you', icon: 'people-outline' },
  { id: 'friends', label: 'Friends', description: 'People you follow who follow you back', icon: 'person-add-outline' },
  { id: 'private', label: 'Private', description: 'Only you can see this video', icon: 'lock-closed-outline' },
];

export function PostSettingsScreen({ navigation }: RootScreenProps<'PostSettings'>) {
  const theme = useTheme();
  const { compose, setCompose, resetCompose } = useApp();
  const [publishing, setPublishing] = useState(false);

  const interactionRows = [
    { id: 'allowComments', label: 'Allow comments', icon: 'chatbubble-outline' as const },
    { id: 'allowShare', label: 'Allow sharing', icon: 'arrow-redo-outline' as const },
    { id: 'allowDownload', label: 'Allow downloads', icon: 'download-outline' as const },
    { id: 'allowRemix', label: 'Allow Remix', icon: 'git-branch-outline' as const },
    { id: 'allowDuet', label: 'Allow Duet', icon: 'people-circle-outline' as const },
  ] as const;

  const publish = () => {
    setPublishing(true);
    setTimeout(() => {
      setPublishing(false);
      resetCompose();
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    }, 900);
  };

  const saveDraft = () => {
    resetCompose();
    navigation.navigate('Drafts');
  };

  return (
    <Screen>
      <Header title="Post settings" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Privacy */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }}
        >
          WHO CAN WATCH THIS VIDEO
        </Text>
        <Card style={{ marginTop: theme.spacing.xs }}>
          {privacyOptions.map((option, index) => (
            <View key={option.id}>
              {index > 0 ? <Divider inset={60} /> : null}
              <ListRow
                label={option.label}
                description={option.description}
                icon={option.icon}
                onPress={() => setCompose({ privacy: option.id })}
                showChevron={false}
                right={
                  compose.privacy === option.id ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={20} color={theme.colors.textMuted} />
                  )
                }
              />
            </View>
          ))}
        </Card>

        {/* Interaction settings */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          INTERACTIONS
        </Text>
        <Card style={{ marginTop: theme.spacing.xs }}>
          {interactionRows.map((row, index) => (
            <View key={row.id}>
              {index > 0 ? <Divider inset={60} /> : null}
              <ListRow
                label={row.label}
                icon={row.icon}
                showChevron={false}
                right={
                  <Toggle
                    value={compose.interaction[row.id]}
                    onValueChange={(value) =>
                      setCompose({ interaction: { ...compose.interaction, [row.id]: value } })
                    }
                  />
                }
              />
            </View>
          ))}
        </Card>

        {/* Summary */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          SUMMARY
        </Text>
        <Card padded style={{ marginTop: theme.spacing.xs, gap: theme.spacing.xs }}>
          <View style={styles.summaryRow}>
            <Text variant="label" tone="secondary" style={styles.flex}>
              Clips
            </Text>
            <Text variant="label">{compose.clips.length || 1}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text variant="label" tone="secondary" style={styles.flex}>
              Sound
            </Text>
            <Text variant="label" numberOfLines={1}>
              {compose.sound?.title ?? 'Original sound'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text variant="label" tone="secondary" style={styles.flex}>
              Hashtags
            </Text>
            <Text variant="label">{compose.hashtags.length}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text variant="label" tone="secondary" style={styles.flex}>
              Effects
            </Text>
            <Text variant="label">{compose.effectIds.length}</Text>
          </View>
          {compose.location ? (
            <View style={styles.summaryRow}>
              <Text variant="label" tone="secondary" style={styles.flex}>
                Location
              </Text>
              <Text variant="label" numberOfLines={1}>
                {compose.location}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Promotion nudge */}
        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <View style={styles.promoHeader}>
            <Ionicons name="trending-up" size={18} color={theme.colors.brand} />
            <Text variant="bodyStrong" style={styles.flex}>
              Promote after posting
            </Text>
            <Badge label="Optional" tone="neutral" size="sm" />
          </View>
          <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
            Promotion buys distribution to real, relevant people. It never adds fake likes,
            followers or comments.
          </Text>
        </Card>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.colors.bg,
            borderTopColor: theme.colors.border,
            padding: theme.spacing.md,
          },
        ]}
      >
        <Button label="Save draft" variant="outline" onPress={saveDraft} style={styles.flex} />
        <Button
          label="Post"
          variant="gradient"
          loading={publishing}
          onPress={publish}
          style={styles.flex}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  promoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
