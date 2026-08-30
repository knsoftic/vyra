import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Text,
  Pressable,
  Avatar,
  Button,
  Sheet,
  ListRow,
  Badge,
  AvatarGroup,
} from '../../components';
import { LiveCommentStream } from '../../components/live/LiveCommentStream';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useBroadcast } from '../../hooks/useLive';
import { users, currentUser } from '../../mock';
import { formatCount, formatDuration } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

export function LiveBroadcastScreen({ navigation, route }: RootScreenProps<'LiveBroadcast'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useApp();

  const streamId = route.params?.streamId;
  const broadcast = useBroadcast(streamId);
  const isLive = broadcast.stream !== null;

  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'guests' | 'more' | 'end'>('none');
  const [guests, setGuests] = useState<typeof users>([]);

  // Only the clock ticks locally. Viewers and coins used to be nudged by this
  // same timer — a broadcast that looked busy whether or not anyone was
  // watching, and earning whether or not anyone had paid. Both now come from
  // the server.
  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const viewers = isLive ? broadcast.viewerCount : 0;
  const coins = isLive ? broadcast.giftCoins : 0;

  const endLive = () => {
    void broadcast.end();
    navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  };

  return (
    <View style={styles.root}>
      {/* Camera feed stand-in */}
      <Image
        source={{ uri: 'https://picsum.photos/seed/broadcast/800/1400' }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={styles.topFade} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.bottomFade} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.hostPill, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
          <Avatar uri={user.avatar} size={30} />
          <View>
            <Text variant="caption" tone="onDark">
              @{user.username}
            </Text>
            <View style={styles.liveRow}>
              <View style={[styles.liveDot, { backgroundColor: theme.colors.brand }]} />
              <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {formatDuration(elapsed)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRight}>
          <SourceTag
            source={isLive ? 'live' : 'sample'}
            noun="broadcast"
            {...(isLive ? {} : { detail: 'preview only' })}
          />
          <View style={[styles.statPill, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
            <Ionicons name="eye" size={13} color="#FFF" />
            <Text variant="caption" tone="onDark">
              {formatCount(viewers)}
            </Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
            <Ionicons name="logo-bitcoin" size={13} color={theme.colors.gold} />
            <Text variant="caption" tone="onDark">
              {formatCount(coins)}
            </Text>
          </View>
          <Pressable onPress={() => setSheet('end')} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="close" size={26} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Guests */}
      {guests.length > 0 ? (
        <View style={[styles.guestStrip, { top: insets.top + 66 }]}>
          {guests.map((guest) => (
            <View key={guest.id} style={[styles.guestTile, { borderColor: theme.colors.accent }]}>
              <Image
                source={{ uri: `https://picsum.photos/seed/guest${guest.id}/200/300` }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              <View style={styles.guestLabel}>
                <Text variant="caption" tone="onDark" numberOfLines={1}>
                  {guest.displayName.split(' ')[0]}
                </Text>
              </View>
              <Pressable
                onPress={() => setGuests((prev) => prev.filter((g) => g.id !== guest.id))}
                style={styles.guestRemove}
                hitSlop={theme.layout.hitSlop}
              >
                <Ionicons name="close-circle" size={16} color="#FFF" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Chat */}
      <View style={[styles.chat, { bottom: insets.bottom + 84 }]}>
        {chatMuted ? (
          <View style={[styles.chatMuted, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
            <Ionicons name="chatbubble-outline" size={14} color="rgba(255,255,255,0.7)" />
            <Text variant="caption" tone="onDark">
              Chat is muted for viewers
            </Text>
          </View>
        ) : (
          <LiveCommentStream height={210} />
        )}
      </View>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 20 }]}>
        {[
          {
            id: 'mic',
            icon: (muted ? 'mic-off' : 'mic') as keyof typeof Ionicons.glyphMap,
            label: 'Mic',
            onPress: () => setMuted((m) => !m),
          },
          { id: 'flip', icon: 'camera-reverse' as const, label: 'Flip' },
          {
            id: 'guests',
            icon: 'people' as const,
            label: 'Guests',
            onPress: () => setSheet('guests'),
          },
          {
            id: 'chat',
            icon: (chatMuted ? 'chatbubble-outline' : 'chatbubbles') as keyof typeof Ionicons.glyphMap,
            label: 'Chat',
            onPress: () => setChatMuted((c) => !c),
          },
          { id: 'more', icon: 'ellipsis-horizontal' as const, label: 'More', onPress: () => setSheet('more') },
        ].map((control) => (
          <Pressable key={control.id} onPress={control.onPress} haptic style={styles.control}>
            <View style={[styles.controlIcon, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
              <Ionicons name={control.icon} size={20} color="#FFF" />
            </View>
            <Text variant="caption" tone="onDark">
              {control.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Guest requests */}
      <Sheet
        visible={sheet === 'guests'}
        onClose={() => setSheet('none')}
        title="Guest requests"
        subtitle="Invite a viewer to join your live"
        height={0.55}
        showClose
      >
        {users.slice(1, 6).map((candidate) => {
          const isGuest = guests.some((g) => g.id === candidate.id);
          return (
            <ListRow
              key={candidate.id}
              label={candidate.displayName}
              description={`@${candidate.username}`}
              left={<Avatar uri={candidate.avatar} size={44} />}
              showChevron={false}
              right={
                <Button
                  label={isGuest ? 'Remove' : 'Invite'}
                  size="sm"
                  variant={isGuest ? 'outline' : 'primary'}
                  onPress={() =>
                    setGuests((prev) =>
                      isGuest ? prev.filter((g) => g.id !== candidate.id) : [...prev, candidate],
                    )
                  }
                />
              }
            />
          );
        })}
      </Sheet>

      {/* More options */}
      <Sheet visible={sheet === 'more'} onClose={() => setSheet('none')} title="Live options" height={0.5} showClose>
        <ListRow label="Beauty and filters" icon="sparkles-outline" onPress={() => setSheet('none')} />
        <ListRow label="Pin a comment" icon="pin-outline" onPress={() => setSheet('none')} />
        <ListRow label="Manage blocked viewers" icon="ban-outline" onPress={() => setSheet('none')} />
        <ListRow label="Share live" icon="share-social-outline" onPress={() => setSheet('none')} />
        <ListRow label="Gift settings" icon="gift-outline" onPress={() => setSheet('none')} />
        <ListRow label="Report a problem" icon="flag-outline" onPress={() => setSheet('none')} />
      </Sheet>

      {/* End confirmation */}
      <Sheet visible={sheet === 'end'} onClose={() => setSheet('none')} title="End live?" height={0.42} showClose>
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text variant="h3">{formatDuration(elapsed)}</Text>
              <Text variant="caption" tone="muted">
                Duration
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text variant="h3">{formatCount(viewers)}</Text>
              <Text variant="caption" tone="muted">
                Peak viewers
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text variant="h3">{formatCount(coins)}</Text>
              <Text variant="caption" tone="muted">
                Coins earned
              </Text>
            </View>
          </View>

          <Text variant="caption" tone="muted" align="center">
            Coins earned during this stream are already in your wallet ledger.
          </Text>

          <Button label="End live" variant="danger" fullWidth onPress={endLive} />
          <Button label="Keep streaming" variant="secondary" fullWidth onPress={() => setSheet('none')} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 340 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  hostPill: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 5, paddingRight: 12, borderRadius: 999 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  guestStrip: { position: 'absolute', right: 12, gap: 8 },
  guestTile: { width: 84, height: 120, borderRadius: 12, overflow: 'hidden', borderWidth: 2 },
  guestLabel: { position: 'absolute', bottom: 4, left: 4, right: 4 },
  guestRemove: { position: 'absolute', top: 3, right: 3 },
  chat: { position: 'absolute', left: 0, right: 80 },
  chatMuted: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
  },
  control: { alignItems: 'center', gap: 4 },
  controlIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
});
