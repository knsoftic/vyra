import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Header, Text, Button, ProgressBar } from '../../components';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { uploadFile, type LocalFile, type UploadProgress, measure} from '../../api/uploads';
import { ApiError } from '../../api';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

/**
 * Pick a video and send it.
 *
 * This screen used to show a grid of sample thumbnails and navigate onward
 * without uploading anything — so "did it upload?" had no answer, because
 * nothing had. Now it reads the phone's real library, sends the file in chunks,
 * and shows progress the server has actually confirmed.
 */
export function UploadScreen({ navigation }: RootScreenProps<'Upload'>) {
  const theme = useTheme();
  const { setCompose } = useApp();

  const [file, setFile] = useState<LocalFile | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<{ cancel: () => void }>({ cancel: () => {} });

  const pick = useCallback(async () => {
    setError(null);

    // Asked at the moment it is needed, with the reason on screen — not at
    // launch, where a permission prompt has no context.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Vyra needs permission to open your gallery so you can choose a video.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    /*
     * The picker leaves `fileSize` undefined for videos on Android, so this
     * measures the file rather than accepting a blank. It used to fall back to
     * 0, and the guard below then refused every gallery upload on those
     * devices with "that file reported no size" — which was true, and useless.
     */
    let sizeBytes: number;
    try {
      sizeBytes = asset.fileSize && asset.fileSize > 0 ? asset.fileSize : await measure(asset.uri);
    } catch {
      setError('That video could not be read from your gallery. Try another one.');
      return;
    }

    setFile({
      uri: asset.uri,
      name: asset.fileName ?? `video-${Date.now()}.mp4`,
      mimeType: asset.mimeType ?? 'video/mp4',
      sizeBytes,
      ...(asset.duration ? { durationMs: asset.duration } : {}),
    });
    setPreview(asset.uri);
    setProgress(null);
  }, []);

  const send = useCallback(async () => {
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    try {
      const completed = await uploadFile(file, setProgress, cancelRef.current);

      // The editor works from the uploaded key, not the local file — the server
      // copy is the one that gets processed and published.
      setCompose({
        clips: [
          {
            id: completed.storageKey,
            thumb: preview ?? '',
            durationSec: file.durationMs ? Math.round(file.durationMs / 1000) : 0,
            speed: 1,
          },
        ],
      });
      navigation.navigate('Editor');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.offline
            ? 'Lost connection. Your progress is saved — press Upload again to continue.'
            : err.message
          : 'The upload failed.',
      );
    } finally {
      setBusy(false);
    }
  }, [file, busy, preview, setCompose, navigation]);

  const percent = progress ? Math.round(progress.fraction * 100) : 0;
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  return (
    <Screen>
      <Header title="Upload a video" />

      <View style={[styles.body, { padding: theme.spacing.lg, gap: theme.spacing.lg }]}>
        {preview ? (
          <View style={[styles.previewWrap, { borderRadius: theme.radius.lg }]}>
            <Image source={{ uri: preview }} style={styles.preview} contentFit="cover" />
          </View>
        ) : (
          <View
            style={[
              styles.empty,
              { borderRadius: theme.radius.lg, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="videocam-outline" size={40} color={theme.colors.textMuted} />
            <Text variant="body" tone="secondary" align="center">
              Choose a video from your gallery
            </Text>
          </View>
        )}

        {file ? (
          <View style={{ gap: 4 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {file.name}
            </Text>
            <Text variant="caption" tone="muted">
              {mb(file.sizeBytes ?? 0)} MB
              {file.durationMs ? ` · ${formatDuration(Math.round(file.durationMs / 1000))}` : ''}
            </Text>
          </View>
        ) : null}

        {progress ? (
          <View style={{ gap: theme.spacing.xs }}>
            <ProgressBar percent={percent} />
            <View style={styles.progressRow}>
              <Text variant="caption" tone="secondary">
                {busy && percent < 100 ? `Uploading… ${percent}%` : `${percent}%`}
              </Text>
              <Text variant="caption" tone="muted">
                {mb(progress.bytesSent)} / {mb(progress.totalBytes)} MB
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              Part {progress.chunksSent} of {progress.totalChunks} confirmed by the server. If the
              connection drops, pressing Upload again continues from here.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={[styles.error, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md }]}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
            <Text variant="caption" style={{ color: theme.colors.danger, flex: 1 }}>
              {error}
            </Text>
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={file ? 'Choose a different video' : 'Choose from gallery'}
            variant={file ? 'secondary' : 'primary'}
            onPress={() => void pick()}
            disabled={busy}
          />
          {file ? (
            <Button
              label={busy ? `Uploading ${percent}%` : 'Upload'}
              variant="primary"
              onPress={() => void send()}
              disabled={busy}
              icon={busy ? undefined : 'cloud-upload-outline'}
            />
          ) : null}
          {busy ? (
            <View style={styles.spinnerRow}>
              <ActivityIndicator color={theme.colors.brand} />
              <Text variant="caption" tone="muted">
                Keep this screen open while it uploads.
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  previewWrap: { width: '100%', aspectRatio: 9 / 16, maxHeight: 320, overflow: 'hidden' },
  preview: { width: '100%', height: '100%' },
  empty: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 320,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  error: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12 },
  spinnerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
});
