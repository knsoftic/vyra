import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Screen, Header, Text, Pressable, Button, Badge, EmptyState } from '../../components';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

/** How many frames to offer along the timeline. */
const FRAME_COUNT = 8;

interface Frame {
  id: string;
  thumb: string;
  /** Milliseconds into the finished video. */
  atMs: number;
}

/**
 * Choosing the poster frame.
 *
 * Frames are pulled from the footage on the device — the same file that was
 * uploaded — so what you pick is what the video will show. The list used to be
 * `coverFrames` from the sample set: eight stock images of somebody else's
 * video, and picking one stored an id the server had never heard of, so the
 * poster stayed whatever the pipeline guessed.
 *
 * The chosen time is what travels, not the image. The server already renders
 * the finished video; asking it for one frame from that is exact, where
 * uploading a device-side thumbnail would be a picture of the *source* before
 * filters, trims and overlays were applied.
 */
export function CoverPickerScreen({ navigation }: RootScreenProps<'CoverPicker'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  const [frames, setFrames] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coverText, setCoverText] = useState('');

  /** Total run time of the edit, trims and speeds included. */
  const totalMs = compose.clips.reduce((sum, clip) => {
    const fullMs = Math.round(clip.durationSec * 1000);
    const used = (clip.trimEndMs ?? fullMs) - (clip.trimStartMs ?? 0);
    return sum + Math.max(0, used) / (clip.speed || 1);
  }, 0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const first = compose.clips[0];
      if (!first?.uri || totalMs <= 0) {
        setLoading(false);
        return;
      }

      const picked: Frame[] = [];
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        // Evenly spaced, skipping the very first frame: videos open on black
        // far too often for it to be a useful suggestion.
        const atMs = Math.round(((i + 0.5) / FRAME_COUNT) * totalMs);
        const sourceMs = (first.trimStartMs ?? 0) + atMs * (first.speed || 1);
        try {
          const frame = await VideoThumbnails.getThumbnailAsync(first.uri, { time: sourceMs });
          picked.push({ id: `frame_${i}`, thumb: frame.uri, atMs });
        } catch {
          // A frame that will not decode is skipped rather than shown blank.
        }
      }

      if (cancelled) return;
      setFrames(picked);
      setSelectedId(
        // Whatever was chosen last time, if it is still one of these.
        picked.find((f) => f.atMs === compose.coverFrameMs)?.id ?? picked[0]?.id ?? null,
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [compose.clips, compose.coverFrameMs, totalMs]);

  const selected = frames.find((frame) => frame.id === selectedId) ?? frames[0] ?? null;

  const save = () => {
    if (selected) setCompose({ coverFrameMs: selected.atMs });
    navigation.goBack();
  };

  return (
    <Screen>
      <Header
        title="Select cover"
        right={
          <Pressable onPress={save} hitSlop={theme.layout.hitSlop}>
            <Text variant="labelStrong" tone="brand">
              Save
            </Text>
          </Pressable>
        }
      />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.colors.brand} />
          <Text variant="caption" tone="muted">
            Reading frames from your video…
          </Text>
        </View>
      ) : !selected ? (
        <View style={styles.centre}>
          <EmptyState
            icon="image-outline"
            title="No frames to choose from"
            description="This happens when the footage is no longer on the device. Your video will still get a cover — one is chosen automatically."
          />
        </View>
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Large preview */}
        <View style={[styles.previewWrap, { margin: theme.spacing.md }]}>
          <Image
            source={{ uri: selected.thumb }}
            style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.lg }]}
            contentFit="cover"
          />
          {coverText ? (
            <View style={styles.coverTextWrap} pointerEvents="none">
              <Text variant="h2" tone="onDark" align="center" style={styles.coverText}>
                {coverText}
              </Text>
            </View>
          ) : null}
          <View style={styles.timeTag}>
            <Text variant="caption" tone="onDark">
              {formatDuration(selected.atMs / 1000)}
            </Text>
          </View>
        </View>

        {/* Frame scrubber */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs }}
        >
          PICK A FRAME
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.scrubber, { paddingHorizontal: theme.spacing.md }]}
        >
          {frames.map((frame) => {
            const active = frame.id === selectedId;
            return (
              <Pressable key={frame.id} onPress={() => setSelectedId(frame.id)}>
                <View
                  style={[
                    styles.frame,
                    {
                      borderColor: active ? theme.colors.brand : 'transparent',
                      borderRadius: theme.radius.sm,
                    },
                  ]}
                >
                  <Image source={{ uri: frame.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
                </View>
                <Text variant="caption" tone="muted" align="center">
                  {formatDuration(frame.atMs / 1000)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }}>
          These are real frames from your video. The one you pick becomes the cover; pick nothing
          and one is chosen for you.
        </Text>

        {/* Cover text */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          COVER TEXT
        </Text>
        <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }}>
          <TextInput
            value={coverText}
            onChangeText={setCoverText}
            placeholder="Add text to your cover"
            placeholderTextColor={theme.colors.textMuted}
            maxLength={40}
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
        </View>

        {/* Custom upload */}
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
          <Button label="Use this cover" variant="gradient" fullWidth onPress={save} />
        </View>
      </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  previewWrap: { height: 340, borderRadius: 16, overflow: 'hidden' },
  coverTextWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20 },
  coverText: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  timeTag: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  scrubber: { gap: 6, paddingBottom: 6 },
  frame: { width: 48, height: 76, borderWidth: 2, overflow: 'hidden' },
  suggestedBadge: { position: 'absolute', top: -4, alignSelf: 'center' },
  input: { minHeight: 48, paddingHorizontal: 14 },
});
