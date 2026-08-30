import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Chip,
  Card,
  ListRow,
  Divider,
  Toggle,
  Avatar,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useBroadcast } from '../../hooks/useLive';
import { liveCategories, currentUser } from '../../mock';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

export function LiveSetupScreen({ navigation }: RootScreenProps<'LiveSetup'>) {
  const theme = useTheme();
  const { user } = useApp();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(liveCategories[0]);
  const [allowComments, setAllowComments] = useState(true);
  const [allowGifts, setAllowGifts] = useState(true);
  const [allowGuests, setAllowGuests] = useState(true);
  const [notifyFollowers, setNotifyFollowers] = useState(true);

  // Starting the stream is a server call: it creates the row and issues the
  // ingest credential. Navigating straight to the broadcast screen without it
  // would show a broadcast nobody could watch.
  const broadcast = useBroadcast();

  const goLive = async () => {
    if (!broadcast.live) {
      // No backend: the broadcast screen runs as a local preview and says so.
      navigation.replace('LiveBroadcast');
      return;
    }
    const started = await broadcast.start({
      title: title.trim(),
      categoryId: category,
      allowComments,
      allowGifts,
      allowGuests,
    });
    if (started) navigation.replace('LiveBroadcast', { streamId: started.stream.id });
  };

  return (
    <Screen>
      <Header title="Go live" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Preview */}
        <View style={[styles.preview, { margin: theme.spacing.md, borderRadius: theme.radius.lg }]}>
          <Image
            source={{ uri: 'https://picsum.photos/seed/livesetup/800/1000' }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.previewOverlay}>
            <Avatar uri={user.avatar} size={52} live />
            <Text variant="bodyStrong" tone="onDark" style={{ marginTop: theme.spacing.sm }}>
              @{user.username}
            </Text>
          </View>

          <Pressable style={[styles.thumbButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Ionicons name="image-outline" size={15} color="#FFF" />
            <Text variant="caption" tone="onDark">
              Change thumbnail
            </Text>
          </Pressable>

          <Pressable style={[styles.flipButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Ionicons name="camera-reverse-outline" size={18} color="#FFF" />
          </Pressable>
        </View>

        {/* Title */}
        <View style={{ paddingHorizontal: theme.spacing.md }}>
          <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
            Stream title
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What are you doing right now?"
            placeholderTextColor={theme.colors.textMuted}
            maxLength={80}
            multiline
            style={[
              theme.typography.body,
              styles.input,
              {
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
              },
            ]}
          />
          <Text variant="caption" tone="muted" align="right" style={{ marginTop: 4 }}>
            {title.length}/80
          </Text>
        </View>

        {/* Category */}
        <Text
          variant="label"
          tone="secondary"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }}
        >
          Category
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md, gap: 8, paddingTop: theme.spacing.xs }}
        >
          {liveCategories.map((item) => (
            <Chip
              key={item}
              label={item}
              selected={category === item}
              onPress={() => setCategory(item)}
            />
          ))}
        </ScrollView>

        {/* Settings */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          STREAM SETTINGS
        </Text>
        <Card style={{ marginTop: theme.spacing.xs }}>
          <ListRow
            label="Allow comments"
            icon="chatbubble-outline"
            showChevron={false}
            right={<Toggle value={allowComments} onValueChange={setAllowComments} />}
          />
          <Divider inset={60} />
          <ListRow
            label="Allow gifts"
            icon="gift-outline"
            showChevron={false}
            right={<Toggle value={allowGifts} onValueChange={setAllowGifts} />}
          />
          <Divider inset={60} />
          <ListRow
            label="Allow guests and co-hosts"
            icon="people-outline"
            showChevron={false}
            right={<Toggle value={allowGuests} onValueChange={setAllowGuests} />}
          />
          <Divider inset={60} />
          <ListRow
            label="Notify followers"
            description={`${(user.followers / 1000).toFixed(0)}k people will get a notification`}
            icon="notifications-outline"
            showChevron={false}
            right={<Toggle value={notifyFollowers} onValueChange={setNotifyFollowers} />}
          />
        </Card>

        {/* Guidelines */}
        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <View style={styles.noticeRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.info} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Live streams are moderated. Repeated guideline violations can remove your ability to
              go live. Your camera and microphone are active only while you are streaming.
            </Text>
          </View>
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
        <Button
          label="Start live"
          variant="gradient"
          size="lg"
          fullWidth
          icon="radio"
          disabled={!title.trim() || broadcast.starting}
          loading={broadcast.starting}
          onPress={() => void goLive()}
        />
        {broadcast.error ? (
          <Text variant="caption" tone="danger" style={{ paddingTop: theme.spacing.xs }}>
            {broadcast.error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preview: { height: 260, overflow: 'hidden', backgroundColor: '#1C1C1F' },
  previewOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumbButton: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  flipButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: { minHeight: 60, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top' },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
