import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, Animated, Easing, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  CameraType,
  FlashMode,
} from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  Screen,
  Text,
  Pressable,
  Button,
  Chip,
  Sheet,
  ListRow,
  EmptyState,
} from '../../components';
import { useTheme } from '../../theme';
import { speedOptions, musicLibrary, galleryItems, beautyControls } from '../../mock';
import { SliderRow } from '../../components/Controls';
import { useApp } from '../../store/AppState';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const MAX_DURATION = 60;
const TIMER_OPTIONS = [0, 3, 10];

interface Clip {
  id: string;
  durationSec: number;
  speed: number;
}

export function RecordScreen({ navigation }: RootScreenProps<'Record'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { setCompose } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  // Recording video with sound needs RECORD_AUDIO as a separate grant. The
  // microphone is used only while recording — never in the background.
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const requestCapturePermissions = async () => {
    await requestPermission();
    await requestMicPermission();
  };

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [speed, setSpeed] = useState(1);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [recording, setRecording] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [beauty, setBeauty] = useState(
    Object.fromEntries(beautyControls.map((c) => [c.id, c.defaultValue])),
  );

  const [sheet, setSheet] = useState<'none' | 'speed' | 'timer' | 'beauty' | 'gallery' | 'music'>('none');

  const recordScale = useRef(new Animated.Value(1)).current;

  const totalRecorded = clips.reduce((sum, clip) => sum + clip.durationSec, 0) + elapsed;
  const progress = Math.min(1, totalRecorded / MAX_DURATION);

  // Recording tick
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      setElapsed((e) => {
        const next = e + 0.1;
        if (next >= MAX_DURATION - clips.reduce((s, c) => s + c.durationSec, 0)) {
          setRecording(false);
          return e;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [recording, clips]);

  // Countdown before recording
  useEffect(() => {
    if (countdown <= 0) return;
    const timeout = setTimeout(() => {
      setCountdown((c) => {
        if (c === 1) setRecording(true);
        return c - 1;
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [countdown]);

  useEffect(() => {
    Animated.timing(recordScale, {
      toValue: recording ? 0.55 : 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [recording, recordScale]);

  const handleRecordPress = useCallback(() => {
    if (recording) {
      // Pause: bank the current segment as a clip.
      setClips((prev) => [...prev, { id: `clip_${Date.now()}`, durationSec: elapsed, speed }]);
      setElapsed(0);
      setRecording(false);
      return;
    }
    if (timer > 0) setCountdown(timer);
    else setRecording(true);
  }, [recording, elapsed, speed, timer]);

  const deleteLastClip = () => setClips((prev) => prev.slice(0, -1));

  const goToEditor = () => {
    const banked = elapsed > 0 ? [...clips, { id: `clip_${Date.now()}`, durationSec: elapsed, speed }] : clips;
    setCompose({
      clips: banked.map((clip, index) => ({
        id: clip.id,
        thumb: `https://picsum.photos/seed/rec${index}/120/200`,
        durationSec: clip.durationSec,
        speed: clip.speed,
      })),
    });
    navigation.navigate('Editor');
  };

  const hasContent = clips.length > 0 || elapsed > 0.4;

  const sideTools = [
    { id: 'flip', icon: 'camera-reverse-outline' as const, label: 'Flip', onPress: () => setFacing((f) => (f === 'back' ? 'front' : 'back')) },
    {
      id: 'flash',
      icon: (flash === 'off' ? 'flash-off-outline' : 'flash-outline') as keyof typeof Ionicons.glyphMap,
      label: 'Flash',
      onPress: () => setFlash((f) => (f === 'off' ? 'on' : 'off')),
    },
    { id: 'speed', icon: 'speedometer-outline' as const, label: `${speed}x`, onPress: () => setSheet('speed') },
    { id: 'timer', icon: 'timer-outline' as const, label: timer > 0 ? `${timer}s` : 'Timer', onPress: () => setSheet('timer') },
    { id: 'beauty', icon: 'sparkles-outline' as const, label: 'Beauty', onPress: () => setSheet('beauty') },
    { id: 'filters', icon: 'color-filter-outline' as const, label: 'Filters', onPress: () => navigation.navigate('Filters') },
    { id: 'effects', icon: 'color-wand-outline' as const, label: 'Effects', onPress: () => navigation.navigate('Effects') },
  ];

  // ── Permission states ──
  if (!permission) {
    return (
      <Screen dark background="#000">
        <View style={styles.center}>
          <Text tone="onDark">Preparing camera…</Text>
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen dark background="#000">
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="close" size={28} color="#FFF" />
          </Pressable>
        </View>
        <View style={styles.center}>
          <EmptyState
            icon="videocam-off-outline"
            title="Camera access needed"
            description="To record a video we need access to your camera and microphone. The microphone is used only while you are recording."
          />
          <View style={{ paddingHorizontal: 32, width: '100%', gap: 10 }}>
            <Button
              label="Allow camera and microphone"
              variant="gradient"
              fullWidth
              onPress={requestCapturePermissions}
            />
            <Button
              label="Upload from gallery instead"
              variant="outline"
              fullWidth
              onPress={() => navigation.navigate('Upload')}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView style={StyleSheet.absoluteFill} facing={facing} flash={flash} mode="video" />

      {/* Multi-clip progress */}
      <View style={[styles.progressTrack, { top: insets.top + 4 }]}>
        {clips.map((clip, index) => (
          <View
            key={clip.id}
            style={{
              width: `${(clip.durationSec / MAX_DURATION) * 100}%`,
              backgroundColor: theme.colors.brand,
              height: '100%',
              borderRightWidth: index < clips.length - 1 || elapsed > 0 ? 2 : 0,
              borderRightColor: '#000',
            }}
          />
        ))}
        {elapsed > 0 ? (
          <View
            style={{
              width: `${(elapsed / MAX_DURATION) * 100}%`,
              backgroundColor: theme.colors.accent,
              height: '100%',
            }}
          />
        ) : null}
      </View>

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="close" size={28} color="#FFF" />
        </Pressable>

        <Pressable
          onPress={() => setSheet('music')}
          style={[styles.musicPill, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
        >
          <Ionicons name="musical-notes" size={14} color="#FFF" />
          <Text variant="label" tone="onDark" numberOfLines={1}>
            Add sound
          </Text>
        </Pressable>

        <View style={styles.timerReadout}>
          {recording || totalRecorded > 0 ? (
            <View style={[styles.recordingPill, { backgroundColor: theme.colors.brand }]}>
              <Text variant="caption" tone="onDark">
                {formatDuration(totalRecorded)}
              </Text>
            </View>
          ) : (
            <View style={{ width: 28 }} />
          )}
        </View>
      </View>

      {/* Microphone is a separate grant — recording silently would be a bad surprise. */}
      {micPermission && !micPermission.granted ? (
        <Pressable
          onPress={requestMicPermission}
          style={[styles.micNotice, { top: insets.top + 66, backgroundColor: theme.colors.warning }]}
        >
          <Ionicons name="mic-off-outline" size={13} color="#0A0A0B" />
          <Text variant="caption" tone="inverse">
            Microphone off — tap to record with sound
          </Text>
        </Pressable>
      ) : null}

      {/* Side tools */}
      <View style={[styles.sideRail, { top: insets.top + 70 }]}>
        {sideTools.map((tool) => (
          <Pressable key={tool.id} onPress={tool.onPress} style={styles.sideTool} haptic>
            <Ionicons name={tool.icon} size={24} color="#FFF" />
            <Text variant="caption" tone="onDark">
              {tool.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Countdown overlay */}
      {countdown > 0 ? (
        <View style={styles.countdown} pointerEvents="none">
          <Text variant="display" tone="onDark" style={styles.countdownText}>
            {countdown}
          </Text>
        </View>
      ) : null}

      {/* Bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.speedRow}
        >
          {speedOptions.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              size="sm"
              selected={speed === option.value}
              tone="brand"
              onPress={() => setSpeed(option.value)}
            />
          ))}
        </ScrollView>

        <View style={styles.controlRow}>
          {/* Gallery */}
          <Pressable onPress={() => navigation.navigate('Upload')} style={styles.sideAction}>
            <Image
              source={{ uri: galleryItems[0].thumb }}
              style={[styles.galleryThumb, { borderRadius: theme.radius.sm }]}
              contentFit="cover"
            />
            <Text variant="caption" tone="onDark">
              Upload
            </Text>
          </Pressable>

          {/* Record button */}
          <Pressable onPress={handleRecordPress} haptic style={styles.recordOuter}>
            <View
              style={[
                styles.recordRing,
                { borderColor: recording ? theme.colors.brand : 'rgba(255,255,255,0.9)' },
              ]}
            />
            <Animated.View
              style={[
                styles.recordInner,
                {
                  backgroundColor: theme.colors.brand,
                  transform: [{ scale: recordScale }],
                  borderRadius: recording ? 10 : 34,
                },
              ]}
            />
            {progress > 0 ? (
              <View
                style={[
                  styles.recordProgress,
                  { borderColor: theme.colors.accent, opacity: progress > 0 ? 1 : 0 },
                ]}
              />
            ) : null}
          </Pressable>

          {/* Clip actions */}
          <View style={styles.sideAction}>
            {hasContent ? (
              <>
                <Pressable onPress={deleteLastClip} haptic style={styles.clipAction}>
                  <Ionicons name="backspace-outline" size={22} color="#FFF" />
                </Pressable>
                <Text variant="caption" tone="onDark">
                  {clips.length} clip{clips.length === 1 ? '' : 's'}
                </Text>
              </>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>
        </View>

        {hasContent ? (
          <View style={styles.nextRow}>
            <Button label="Next" variant="gradient" icon="checkmark" onPress={goToEditor} />
          </View>
        ) : null}
      </View>

      {/* Speed sheet */}
      <Sheet visible={sheet === 'speed'} onClose={() => setSheet('none')} title="Recording speed" height={0.35}>
        {speedOptions.map((option) => (
          <ListRow
            key={option.id}
            label={option.label}
            description={
              option.value < 1 ? 'Slower playback' : option.value > 1 ? 'Faster playback' : 'Normal'
            }
            onPress={() => {
              setSpeed(option.value);
              setSheet('none');
            }}
            showChevron={false}
            right={
              speed === option.value ? (
                <Ionicons name="checkmark" size={18} color={theme.colors.brand} />
              ) : null
            }
          />
        ))}
      </Sheet>

      {/* Timer sheet */}
      <Sheet visible={sheet === 'timer'} onClose={() => setSheet('none')} title="Countdown timer" height={0.3}>
        {TIMER_OPTIONS.map((option) => (
          <ListRow
            key={option}
            label={option === 0 ? 'Off' : `${option} seconds`}
            onPress={() => {
              setTimer(option);
              setSheet('none');
            }}
            showChevron={false}
            right={timer === option ? <Ionicons name="checkmark" size={18} color={theme.colors.brand} /> : null}
          />
        ))}
      </Sheet>

      {/* Beauty sheet */}
      <Sheet visible={sheet === 'beauty'} onClose={() => setSheet('none')} title="Beauty" height={0.45}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.md }}>
          <Text variant="caption" tone="muted" style={{ paddingVertical: theme.spacing.sm }}>
            These are rendering options only. They are never used for recommendations or ad targeting.
          </Text>
          {beautyControls.map((control) => (
            <SliderRow
              key={control.id}
              label={control.label}
              value={beauty[control.id]}
              min={control.min}
              max={control.max}
              defaultValue={control.defaultValue}
              onChange={(value) => setBeauty((prev) => ({ ...prev, [control.id]: value }))}
            />
          ))}
        </ScrollView>
      </Sheet>

      {/* Music sheet */}
      <Sheet visible={sheet === 'music'} onClose={() => setSheet('none')} title="Add sound" height={0.6}>
        <ScrollView>
          {musicLibrary.slice(0, 8).map((sound) => (
            <ListRow
              key={sound.id}
              label={sound.title}
              description={sound.artist}
              left={
                <Image
                  source={{ uri: sound.cover }}
                  style={{ width: 44, height: 44, borderRadius: theme.radius.sm }}
                  contentFit="cover"
                />
              }
              onPress={() => setSheet('none')}
              showChevron={false}
              right={<Ionicons name="play-circle-outline" size={22} color={theme.colors.textSecondary} />}
            />
          ))}
          <View style={{ padding: theme.spacing.md }}>
            <Button
              label="Browse full music library"
              variant="secondary"
              fullWidth
              onPress={() => {
                setSheet('none');
                navigation.navigate('Music');
              }}
            />
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progressTrack: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    overflow: 'hidden',
    zIndex: 3,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 2,
  },
  musicPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: 180,
  },
  timerReadout: { alignItems: 'flex-end', minWidth: 28 },
  recordingPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  micNotice: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    zIndex: 3,
  },
  sideRail: { position: 'absolute', right: 12, gap: 18, alignItems: 'center', zIndex: 2 },
  sideTool: { alignItems: 'center', gap: 2 },
  countdown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  countdownText: { fontSize: 68, fontWeight: '800' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: 14 },
  speedRow: { paddingHorizontal: 16, gap: 8, justifyContent: 'center', flexGrow: 1 },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  sideAction: { alignItems: 'center', gap: 4, width: 64 },
  galleryThumb: { width: 40, height: 40, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  clipAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordOuter: { width: 86, height: 86, alignItems: 'center', justifyContent: 'center' },
  recordRing: { position: 'absolute', width: 86, height: 86, borderRadius: 43, borderWidth: 5 },
  recordProgress: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 3,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  recordInner: { width: 68, height: 68 },
  nextRow: { alignItems: 'center' },
});
