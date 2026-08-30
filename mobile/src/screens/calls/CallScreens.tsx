import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Pressable, Avatar, VerifiedBadge } from '../../components';
import { useTheme } from '../../theme';
import { useContentWidth } from '../../hooks/useResponsive';
import { getUser, chats, currentUser } from '../../mock';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { User } from '../../types';

type CallState = 'ringing' | 'connecting' | 'active' | 'ended';

/** Circular control used across all three call surfaces. */
function CallButton({
  icon,
  label,
  active = false,
  danger = false,
  size = 56,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  active?: boolean;
  danger?: boolean;
  size?: number;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const background = danger
    ? theme.colors.danger
    : active
      ? '#FFFFFF'
      : 'rgba(255,255,255,0.16)';
  const color = danger ? '#FFFFFF' : active ? '#0A0A0B' : '#FFFFFF';

  return (
    <View style={styles.controlWrap}>
      <Pressable
        onPress={onPress}
        haptic
        style={[
          styles.control,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
        ]}
      >
        <Ionicons name={icon} size={size * 0.42} color={color} />
      </Pressable>
      {label ? (
        <Text variant="caption" tone="onDark">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

function useCallTimer(state: CallState) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (state !== 'active') return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [state]);
  return seconds;
}

// ───────────────────────────── Voice call ───────────────────────────────

export function VoiceCallScreen({ navigation, route }: RootScreenProps<'VoiceCall'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = getUser(route.params.userId);

  const [state, setState] = useState<CallState>('connecting');
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const seconds = useCallTimer(state);

  useEffect(() => {
    const timer = setTimeout(() => setState('active'), 1800);
    return () => clearTimeout(timer);
  }, []);

  const end = () => {
    setState('ended');
    setTimeout(() => navigation.goBack(), 500);
  };

  return (
    <View style={styles.root}>
      <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
      <LinearGradient colors={['rgba(10,10,11,0.7)', '#0A0A0B']} style={StyleSheet.absoluteFill} />

      <View style={[styles.callHeader, { paddingTop: insets.top + 40 }]}>
        <Avatar uri={user.avatar} size={128} />
        <View style={styles.nameRow}>
          <Text variant="h1" tone="onDark">
            {user.displayName}
          </Text>
          <VerifiedBadge tier={user.verification} size={18} />
        </View>
        <Text variant="body" style={{ color: 'rgba(255,255,255,0.65)' }}>
          {state === 'connecting'
            ? 'Calling…'
            : state === 'ended'
              ? 'Call ended'
              : formatDuration(seconds)}
        </Text>

        <View style={[styles.encryptionRow, { marginTop: theme.spacing.md }]}>
          <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.5)" />
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Voice call
          </Text>
        </View>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.controlRow}>
          <CallButton icon={muted ? 'mic-off' : 'mic'} label="Mute" active={muted} onPress={() => setMuted((m) => !m)} />
          <CallButton
            icon={speaker ? 'volume-high' : 'volume-medium'}
            label="Speaker"
            active={speaker}
            onPress={() => setSpeaker((s) => !s)}
          />
          <CallButton
            icon="videocam"
            label="Video"
            onPress={() => navigation.replace('VideoCall', { userId: user.id })}
          />
        </View>
        <View style={styles.controlRow}>
          <CallButton icon="person-add" label="Add" />
          <CallButton icon="call" danger size={68} onPress={end} />
          <CallButton icon="chatbubble" label="Message" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </View>
  );
}

// ───────────────────────────── Video call ───────────────────────────────

export function VideoCallScreen({ navigation, route }: RootScreenProps<'VideoCall'>) {
  const insets = useSafeAreaInsets();
  const user = getUser(route.params.userId);

  const [state, setState] = useState<CallState>('connecting');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const seconds = useCallTimer(state);

  useEffect(() => {
    const timer = setTimeout(() => setState('active'), 1600);
    return () => clearTimeout(timer);
  }, []);

  const end = () => {
    setState('ended');
    setTimeout(() => navigation.goBack(), 400);
  };

  return (
    <Pressable style={styles.root} onPress={() => setControlsVisible((v) => !v)} activeOpacity={1}>
      {/* Remote video */}
      <Image
        source={{ uri: `https://picsum.photos/seed/call${user.id}/800/1400` }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />

      {/* Self view */}
      <View style={[styles.selfView, { top: insets.top + 60 }]}>
        {cameraOff ? (
          <View style={styles.cameraOff}>
            <Ionicons name="videocam-off" size={22} color="rgba(255,255,255,0.7)" />
          </View>
        ) : (
          <Image
            source={{ uri: currentUser.avatar }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        )}
      </View>

      {controlsVisible ? (
        <>
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent']}
            style={[styles.topFade, { paddingTop: insets.top + 12 }]}
          >
            <View style={styles.nameRow}>
              <Text variant="h3" tone="onDark">
                {user.displayName}
              </Text>
              <VerifiedBadge tier={user.verification} size={15} />
            </View>
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {state === 'connecting' ? 'Connecting…' : formatDuration(seconds)}
            </Text>
          </LinearGradient>

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.75)']}
            style={[styles.bottomFade, { paddingBottom: insets.bottom + 28 }]}
          >
            <View style={styles.controlRow}>
              <CallButton icon={muted ? 'mic-off' : 'mic'} label="Mute" active={muted} onPress={() => setMuted((m) => !m)} />
              <CallButton
                icon={cameraOff ? 'videocam-off' : 'videocam'}
                label="Camera"
                active={cameraOff}
                onPress={() => setCameraOff((c) => !c)}
              />
              <CallButton icon="camera-reverse" label="Flip" />
              <CallButton icon="tv-outline" label="Share" />
              <CallButton icon="call" danger onPress={end} />
            </View>
          </LinearGradient>
        </>
      ) : null}
    </Pressable>
  );
}

// ───────────────────────────── Group call ───────────────────────────────

export function GroupCallScreen({ navigation, route }: RootScreenProps<'GroupCall'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const chat = chats.find((c) => c.id === route.params?.chatId) ?? chats[2];
  const participants: User[] = chat.participants.slice(0, 6);

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const seconds = useCallTimer('active');

  const columns = participants.length <= 2 ? 1 : 2;
  const gridWidth = useContentWidth();
  const tileWidth = columns === 1 ? gridWidth - 24 : (gridWidth - 36) / 2;

  return (
    <View style={styles.root}>
      <View style={[styles.groupHeader, { paddingTop: insets.top + 10 }]}>
        <Text variant="bodyStrong" tone="onDark">
          {chat.title}
        </Text>
        <Text variant="caption" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {participants.length} on the call · {formatDuration(seconds)}
        </Text>
      </View>

      <View style={styles.grid}>
        {participants.map((participant, index) => (
          <View
            key={participant.id}
            style={[
              styles.tile,
              {
                width: tileWidth,
                height: columns === 1 ? 320 : tileWidth * 1.25,
                borderRadius: theme.radius.lg,
                borderColor: index === 0 ? theme.colors.accent : 'transparent',
              },
            ]}
          >
            <Image
              source={{ uri: `https://picsum.photos/seed/gcall${participant.id}/400/600` }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
            <View style={styles.tileFooter}>
              <Text variant="caption" tone="onDark" numberOfLines={1}>
                {participant.id === currentUser.id ? 'You' : participant.displayName}
              </Text>
              {index % 3 === 0 ? <Ionicons name="mic-off" size={12} color="#FFF" /> : null}
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.controlRow}>
          <CallButton icon={muted ? 'mic-off' : 'mic'} label="Mute" active={muted} onPress={() => setMuted((m) => !m)} />
          <CallButton
            icon={cameraOff ? 'videocam-off' : 'videocam'}
            label="Camera"
            active={cameraOff}
            onPress={() => setCameraOff((c) => !c)}
          />
          <CallButton icon="person-add" label="Invite" />
          <CallButton icon="chatbubble" label="Chat" />
          <CallButton icon="call" danger onPress={() => navigation.goBack()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0B' },
  callHeader: { alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  encryptionRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 24 },
  controlRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, flexWrap: 'wrap' },
  controlWrap: { alignItems: 'center', gap: 6 },
  control: { alignItems: 'center', justifyContent: 'center' },
  selfView: {
    position: 'absolute',
    right: 14,
    width: 100,
    height: 150,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1C1C1F',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cameraOff: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: 20, gap: 2 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 40 },
  groupHeader: { alignItems: 'center', gap: 2, paddingBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 12, justifyContent: 'center' },
  tile: { overflow: 'hidden', borderWidth: 2 },
  tileFooter: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
