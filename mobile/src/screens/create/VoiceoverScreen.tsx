import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Screen, Header, Text, Pressable, Button, Card, Divider } from '../../components';
import { Slider } from '../../components/Controls';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { uploadFile, type UploadProgress } from '../../api/uploads';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function VoiceoverScreen({ navigation }: RootScreenProps<'Voiceover'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  /**
   * Takes, on disk and on the server.
   *
   * The microphone is opened only while recording — never in the background,
   * and never without the person pressing record (ADR-008). `stop()` closes it.
   *
   * This screen used to count seconds on a `setInterval` and add an entry to a
   * list; nothing was captured, nothing was uploaded, and the finished video
   * had no voice on it whatever the screen showed.
   */
  interface Take {
    id: string;
    uri: string;
    durationSec: number;
    /** Storage key once uploaded. Empty while it is still local. */
    key: string;
  }

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recording = recorderState.isRecording;

  const [takes, setTakes] = useState<Take[]>([]);
  const [uploading, setUploading] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  const elapsed = recording ? (recorderState.durationMillis ?? 0) / 1000 : 0;

  const totalDuration =
    compose.clips.reduce((sum, clip) => {
      const fullMs = Math.round(clip.durationSec * 1000);
      const used = (clip.trimEndMs ?? fullMs) - (clip.trimStartMs ?? 0);
      return sum + Math.max(0, used) / 1000 / (clip.speed || 1);
    }, 0) || 30;

  const startRecording = useCallback(async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone access is needed to record a voiceover.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      startedAt.current = Date.now();
      recorder.record();
    } catch (err) {
      setError((err as Error).message || 'Could not start recording.');
    }
  }, [recorder]);

  /**
   * Stops, then uploads the take.
   *
   * Uploaded here rather than at publish so a failure surfaces while the person
   * is still on this screen and can simply record it again.
   */
  const stopRecording = useCallback(async () => {
    const durationSec = (Date.now() - startedAt.current) / 1000;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // Already stopped; the uri below is what matters.
    }

    const uri = recorder.uri;
    if (!uri || durationSec < 0.3) return;

    const take: Take = { id: `take_${Date.now()}`, uri, durationSec, key: '' };
    setTakes((prev) => [...prev, take]);

    try {
      const completed = await uploadFile(
        {
          uri,
          name: `voiceover-${Date.now()}.m4a`,
          mimeType: 'audio/m4a',
          sizeBytes: 0,
          durationMs: Math.round(durationSec * 1000),
        },
        setUploading,
      );
      setTakes((prev) => prev.map((t) => (t.id === take.id ? { ...t, key: completed.storageKey } : t)));
    } catch {
      setError('That take could not be uploaded. Record it again, or continue without it.');
      setTakes((prev) => prev.filter((t) => t.id !== take.id));
    } finally {
      setUploading(null);
    }
  }, [recorder]);

  /*
   * Uploaded takes become voice tracks on the edit list, laid end to end from
   * the start of the timeline. A take still uploading is deliberately left out
   * rather than sent with an empty key, which the server would refuse.
   */
  useEffect(() => {
    const ready = takes.filter((take) => take.key);
    const others = compose.voiceTracks ?? [];
    if (ready.length === others.length) return;

    let cursor = 0;
    setCompose({
      voiceTracks: ready.map((take) => {
        const startMs = cursor;
        cursor += Math.round(take.durationSec * 1000);
        return {
          id: take.id,
          sourceKey: take.key,
          startMs,
          durationMs: Math.round(take.durationSec * 1000),
        };
      }),
    });
  }, [takes, compose.voiceTracks, setCompose]);

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
            onPress={() => void (recording ? stopRecording() : startRecording())}
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
