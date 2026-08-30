import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Pressable, Button, Badge } from '../../components';
import { useTheme } from '../../theme';
import { coverFrames } from '../../mock';
import { useApp } from '../../store/AppState';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function CoverPickerScreen({ navigation }: RootScreenProps<'CoverPicker'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  const suggested = coverFrames.find((frame) => frame.isSuggested) ?? coverFrames[0];
  const [selectedId, setSelectedId] = useState(compose.coverFrameId ?? suggested.id);
  const [coverText, setCoverText] = useState('');

  const selected = coverFrames.find((frame) => frame.id === selectedId) ?? coverFrames[0];

  const save = () => {
    setCompose({ coverFrameId: selectedId });
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
              {formatDuration(selected.atSecond)}
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
          {coverFrames.map((frame) => {
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
                {frame.isSuggested ? (
                  <Badge label="Suggested" tone="accent" size="sm" style={styles.suggestedBadge} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <Text variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }}>
          The suggested frame is the one our thumbnail analysis scored highest. You can always
          pick your own.
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
          <Button
            label="Upload custom thumbnail"
            variant="outline"
            icon="image-outline"
            fullWidth
          />
          <Button label="Use this cover" variant="gradient" fullWidth onPress={save} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
