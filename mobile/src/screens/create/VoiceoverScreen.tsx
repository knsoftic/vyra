import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Pressable, Button, Card, Divider } from '../../components';
import { Slider } from '../../components/Controls';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function VoiceoverScreen({ navigation }: RootScreenProps<'Voiceover'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [takes, setTakes] = useState<{ id: string; durationSec: number }[]>([]);

  const totalDuration = compose.clips.reduce((sum, clip) => sum + clip.durationSec / clip.speed, 0) || 30;

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setElapsed((e) => Math.min(totalDuration, e + 0.1)), 100);
    return () => clearInterval(interval);
  }, [recording, totalDuration]);

  const stopRecording = () => {
    setRecording(false);
    if (elapsed > 0.3) {
      setTakes((prev) => [...prev, { id: `take_${Date.now()}`, durationSec: elapsed }]);
    }
    setElapsed(0);
  };

  const volumeRows = [
    { id: 'original', label: 'Original audio', icon: 'videocam-outline' as const },
    { id: 'music', label: 'Music', icon: 'musical-notes-outline' as const },
    { id: 'voice', label: 'Voiceover', icon: 'mic-outline' as const },
  ];

  return (
    <Screen>
      <Header
        title="Voiceover"
        right={
          <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
            <Text variant="labelStrong" tone="brand">
              Done
            </Text>
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={[styles.previewWrap, { margin: theme.spacing.md }]}>
          <EditorPreview />
        </View>

        {/* Recording control */}
        <View style={styles.recordWrap}>
          <Text variant="h2">{formatDuration(elapsed)}</Text>
          <Text variant="caption" tone="muted">
            of {formatDuration(totalDuration)}
          </Text>

          <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceAlt }]}>
            <View
              style={{
                width: `${(elapsed / totalDuration) * 100}%`,
                height: '100%',
                backgroundColor: theme.colors.brand,
                borderRadius: 2,
              }}
            />
          </View>

          <Pressable
            onPress={recording ? stopRecording : () => setRecording(true)}
            haptic
            style={[
              styles.recordButton,
              {
                backgroundColor: recording ? theme.colors.surfaceAlt : theme.colors.brand,
                borderColor: theme.colors.brand,
              },
            ]}
          >
            <Ionicons
              name={recording ? 'stop' : 'mic'}
              size={28}
              color={recording ? theme.colors.brand : '#FFF'}
            />
          </Pressable>

          <Text variant="caption" tone="muted" align="center" style={{ maxWidth: 280 }}>
            The microphone is used only while you are recording this voiceover.
          </Text>
        </View>

        {/* Takes */}
        {takes.length > 0 ? (
          <>
            <Text
              variant="labelStrong"
              tone="muted"
              style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
            >
              TAKES
            </Text>
            <Card style={{ marginTop: theme.spacing.xs }}>
              {takes.map((take, index) => (
                <View key={take.id}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <View style={[styles.takeRow, { padding: theme.spacing.md }]}>
                    <Ionicons name="play-circle-outline" size={22} color={theme.colors.text} />
                    <View style={styles.flex}>
                      <Text variant="body">Take {index + 1}</Text>
                      <Text variant="caption" tone="muted">
                        {formatDuration(take.durationSec)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setTakes((prev) => prev.filter((t) => t.id !== take.id))}
                      hitSlop={theme.layout.hitSlop}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {/* Volume mixer */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          VOLUME MIX
        </Text>
        <Card padded style={{ marginTop: theme.spacing.xs, gap: theme.spacing.sm }}>
          {volumeRows.map((row) => {
            const value = compose.volumes[row.id as keyof typeof compose.volumes];
            return (
              <View key={row.id}>
                <View style={styles.volumeHeader}>
                  <Ionicons name={row.icon} size={15} color={theme.colors.textSecondary} />
                  <Text variant="label" tone="secondary" style={styles.flex}>
                    {row.label}
                  </Text>
                  <Text variant="label">{value}</Text>
                </View>
                <Slider
                  value={value}
                  onChange={(next) =>
                    setCompose({ volumes: { ...compose.volumes, [row.id]: next } })
                  }
                />
              </View>
            );
          })}
        </Card>

        <View style={{ padding: theme.spacing.md }}>
          <Button
            label="Save voiceover"
            variant="gradient"
            fullWidth
            disabled={takes.length === 0}
            onPress={() => navigation.goBack()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  previewWrap: { height: 180 },
  recordWrap: { alignItems: 'center', gap: 10, paddingHorizontal: 32 },
  progressTrack: { height: 4, borderRadius: 2, width: '100%', marginVertical: 6 },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  takeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  volumeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
});
