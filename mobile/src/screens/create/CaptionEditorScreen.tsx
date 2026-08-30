import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Chip,
  Avatar,
  Card,
  ListRow,
  Sheet,
} from '../../components';
import { useTheme } from '../../theme';
import { trendingHashtags, users, coverFrames } from '../../mock';
import { useApp } from '../../store/AppState';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const MAX_CAPTION = 2200;

export function CaptionEditorScreen({ navigation }: RootScreenProps<'CaptionEditor'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  const [caption, setCaption] = useState(compose.caption);
  const [picker, setPicker] = useState<'none' | 'hashtag' | 'mention' | 'location'>('none');
  const [location, setLocation] = useState(compose.location);

  const cover =
    coverFrames.find((frame) => frame.id === compose.coverFrameId) ??
    coverFrames.find((frame) => frame.isSuggested) ??
    coverFrames[0];

  const addHashtag = (tag: string) => {
    if (!compose.hashtags.includes(tag)) {
      setCompose({ hashtags: [...compose.hashtags, tag] });
    }
    setPicker('none');
  };

  const addMention = (username: string) => {
    if (!compose.mentions.includes(username)) {
      setCompose({ mentions: [...compose.mentions, username] });
    }
    setPicker('none');
  };

  const proceed = () => {
    setCompose({ caption, location });
    navigation.navigate('PostSettings');
  };

  return (
    <Screen>
      <Header title="Add details" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Caption + cover */}
          <View style={[styles.captionRow, { padding: theme.spacing.md }]}>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Describe your video. Good captions get watched longer."
              placeholderTextColor={theme.colors.textMuted}
              multiline
              maxLength={MAX_CAPTION}
              style={[
                theme.typography.body,
                styles.captionInput,
                { color: theme.colors.text },
              ]}
            />
            <Pressable onPress={() => navigation.navigate('CoverPicker')} style={styles.coverWrap}>
              <Image
                source={{ uri: cover.thumb }}
                style={[styles.cover, { borderRadius: theme.radius.sm }]}
                contentFit="cover"
              />
              <View style={styles.coverLabel}>
                <Text variant="caption" tone="onDark">
                  Cover
                </Text>
              </View>
            </Pressable>
          </View>

          <View style={[styles.counterRow, { paddingHorizontal: theme.spacing.md }]}>
            <Text variant="caption" tone="muted">
              {caption.length}/{MAX_CAPTION}
            </Text>
          </View>

          {/* Quick actions */}
          <View style={[styles.quickRow, { paddingHorizontal: theme.spacing.md }]}>
            <Chip label="# Hashtags" icon="pricetag-outline" onPress={() => setPicker('hashtag')} />
            <Chip label="@ Mention" icon="at-outline" onPress={() => setPicker('mention')} />
            <Chip label="Location" icon="location-outline" onPress={() => setPicker('location')} />
          </View>

          {/* Selected hashtags */}
          {compose.hashtags.length > 0 ? (
            <View style={[styles.tagWrap, { paddingHorizontal: theme.spacing.md }]}>
              {compose.hashtags.map((tag) => (
                <Chip
                  key={tag}
                  label={`#${tag}`}
                  size="sm"
                  tone="brand"
                  selected
                  icon="close"
                  onPress={() =>
                    setCompose({ hashtags: compose.hashtags.filter((t) => t !== tag) })
                  }
                />
              ))}
            </View>
          ) : null}

          {/* Selected mentions */}
          {compose.mentions.length > 0 ? (
            <View style={[styles.tagWrap, { paddingHorizontal: theme.spacing.md }]}>
              {compose.mentions.map((mention) => (
                <Chip
                  key={mention}
                  label={`@${mention}`}
                  size="sm"
                  selected
                  icon="close"
                  onPress={() =>
                    setCompose({ mentions: compose.mentions.filter((m) => m !== mention) })
                  }
                />
              ))}
            </View>
          ) : null}

          {/* Location */}
          {location ? (
            <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm }}>
              <Chip
                label={location}
                icon="location"
                selected
                onPress={() => setLocation(undefined)}
              />
            </View>
          ) : null}

          {/* Sound summary */}
          <Card style={{ marginTop: theme.spacing.lg }}>
            <ListRow
              label={compose.sound ? compose.sound.title : 'Original sound'}
              description={compose.sound ? compose.sound.artist : 'Audio recorded with your clips'}
              icon="musical-notes-outline"
              onPress={() => navigation.navigate('Music')}
            />
            <ListRow
              label="Cover"
              description="Choose the frame people see first"
              icon="image-outline"
              onPress={() => navigation.navigate('CoverPicker')}
            />
          </Card>

          {/* Suggested hashtags */}
          <Text
            variant="labelStrong"
            tone="muted"
            style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
          >
            SUGGESTED HASHTAGS
          </Text>
          <View style={[styles.tagWrap, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }]}>
            {trendingHashtags.slice(0, 6).map((hashtag) => (
              <Chip
                key={hashtag.id}
                label={`#${hashtag.tag}`}
                size="sm"
                onPress={() => addHashtag(hashtag.tag)}
              />
            ))}
          </View>
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
            label="Drafts"
            variant="outline"
            onPress={() => navigation.navigate('Drafts')}
            style={styles.flex}
          />
          <Button label="Next" variant="gradient" onPress={proceed} style={styles.flex} />
        </View>
      </KeyboardAvoidingView>

      {/* Hashtag picker */}
      <Sheet
        visible={picker === 'hashtag'}
        onClose={() => setPicker('none')}
        title="Add hashtags"
        height={0.6}
        showClose
      >
        <ScrollView>
          {trendingHashtags.map((hashtag) => (
            <ListRow
              key={hashtag.id}
              label={`#${hashtag.tag}`}
              description={`${formatCount(hashtag.views)} views`}
              icon="pricetag-outline"
              onPress={() => addHashtag(hashtag.tag)}
              showChevron={false}
            />
          ))}
        </ScrollView>
      </Sheet>

      {/* Mention picker */}
      <Sheet
        visible={picker === 'mention'}
        onClose={() => setPicker('none')}
        title="Mention someone"
        height={0.6}
        showClose
      >
        <ScrollView>
          {users.slice(1).map((user) => (
            <ListRow
              key={user.id}
              label={user.displayName}
              description={`@${user.username}`}
              left={<Avatar uri={user.avatar} size={40} />}
              onPress={() => addMention(user.username)}
              showChevron={false}
            />
          ))}
        </ScrollView>
      </Sheet>

      {/* Location picker */}
      <Sheet
        visible={picker === 'location'}
        onClose={() => setPicker('none')}
        title="Add location"
        height={0.5}
        showClose
      >
        <View style={{ padding: theme.spacing.md }}>
          <Text variant="caption" tone="muted">
            Location is optional and only added when you choose a place.
          </Text>
        </View>
        {['Current location', 'Lahore, Pakistan', 'London, UK', 'New York, USA', 'Dubai, UAE'].map(
          (place) => (
            <ListRow
              key={place}
              label={place}
              icon="location-outline"
              onPress={() => {
                setLocation(place);
                setPicker('none');
              }}
              showChevron={false}
            />
          ),
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  captionRow: { flexDirection: 'row', gap: 12 },
  captionInput: { flex: 1, minHeight: 110, textAlignVertical: 'top' },
  coverWrap: { width: 84, height: 110 },
  cover: { width: 84, height: 110 },
  coverLabel: {
    position: 'absolute',
    bottom: 5,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  counterRow: { alignItems: 'flex-end' },
  quickRow: { flexDirection: 'row', gap: 8, paddingTop: 12, flexWrap: 'wrap' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 10 },
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
