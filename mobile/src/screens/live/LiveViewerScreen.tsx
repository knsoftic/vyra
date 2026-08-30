import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TextInput, Animated, Easing, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Pressable, Avatar, Button, Sheet, ListRow, VerifiedBadge } from '../../components';
import { LiveCommentStream } from '../../components/live/LiveCommentStream';
import { GiftSheet } from '../../components/live/GiftSheet';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useWatchStream } from '../../hooks/useLive';
import { liveStreams } from '../../mock';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';
import type { Gift } from '../../types';

export function LiveViewerScreen({ navigation, route }: RootScreenProps<'LiveViewer'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isFollowing, toggleFollow } = useApp();
  const { streamId } = route.params;

  // Joins the stream, subscribes to its events, and leaves on the way out.
  const watch = useWatchStream(streamId);

  const sample = liveStreams.find((s) => s.id === streamId) ?? liveStreams[0];

  const stream = watch.stream
    ? {
        ...sample,
        id: watch.stream.id,
        title: watch.stream.title,
        thumbnail: watch.stream.cover ?? sample.thumbnail,
        host: {
          ...sample.host,
          id: watch.stream.host.id,
          username: watch.stream.host.username,
          displayName: watch.stream.host.displayName,
          avatar: watch.stream.host.avatar ?? sample.host.avatar,
          verification: watch.stream.host.verificationTier,
          followers: watch.stream.host.followers,
        },
      }
    : sample;

  const following = isFollowing(stream.host);

  const [comment, setComment] = useState('');
  const [giftOpen, setGiftOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sentGift, setSentGift] = useState<{ gift: Gift; quantity: number } | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);

  const giftScale = useRef(new Animated.Value(0)).current;
  const heartAnim = useRef(new Animated.Value(0)).current;

  /**
   * The viewer count and like total come from the server.
   *
   * They used to be a local number nudged by a timer every two seconds, which
   * made a stream look busier than it was — invented engagement, which this
   * product does not do. With no backend the sample figures stand in and the
   * badge says so.
   */
  const viewers = watch.live ? watch.viewerCount : sample.viewers;
  const likes = watch.live ? watch.likeCount : sample.likes;

  const playHeart = () => {
    heartAnim.setValue(0);
    Animated.timing(heartAnim, {
      toValue: 1,
      duration: 1400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const sendLike = () => {
    playHeart();
    void watch.sendLike(1);
  };

  const playGift = (gift: Gift, quantity: number) => {
    setSentGift({ gift, quantity });
    giftScale.setValue(0);
    Animated.sequence([
      Animated.spring(giftScale, { toValue: 1, useNativeDriver: true, friction: 5 }),
      Animated.timing(giftScale, { toValue: 0, duration: 400, delay: 1400, useNativeDriver: true }),
    ]).start(() => setSentGift(null));
  };

  /**
   * Sending a gift spends real coins.
   *
   * The animation plays only after the server has accepted the charge — showing
   * it first would tell the sender their gift landed when it may have been
   * refused for want of balance.
   */
  const sendGift = (gift: Gift, quantity: number) => {
    setGiftOpen(false);
    setGiftError(null);

    if (!watch.live) {
      // No backend: nothing is spent, and the animation is clearly a preview.
      playGift(gift, quantity);
      return;
    }

    void watch.sendGift(gift.id, quantity).then((error) => {
      if (error) {
        setGiftError(error);
        return;
      }
      playGift(gift, quantity);
    });
  };

  // A gift from anyone else in the stream, animated the same way.
  useEffect(() => {
    if (!watch.incomingGift) return;
    const { icon, name, quantity } = watch.incomingGift;
    playGift({ id: 'incoming', name, icon, coins: 0 } as Gift, quantity);
    watch.clearGift();
  }, [watch.incomingGift]);

  const submitComment = () => {
    const text = comment.trim();
    if (!text) return;
    setComment('');
    void watch.comment(text);
  };

  const heartTranslate = heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -180] });
  const heartOpacity = heartAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });

  return (
    <View style={styles.root}>
      <Image source={{ uri: stream.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={styles.topFade} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bottomFade} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => navigation.navigate('Profile', { userId: stream.host.id })}
          style={[styles.hostPill, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
        >
          <Avatar uri={stream.host.avatar} size={30} />
          <View style={styles.hostInfo}>
            <View style={styles.nameRow}>
              <Text variant="caption" tone="onDark" numberOfLines={1}>
                {stream.host.displayName}
              </Text>
              <VerifiedBadge tier={stream.host.verification} size={11} />
            </View>
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {formatCount(stream.host.followers)} followers
            </Text>
          </View>
          {!following ? (
            <Button label="Follow" size="sm" variant="primary" onPress={() => toggleFollow(stream.host.id)} />
          ) : null}
        </Pressable>

        <View style={styles.headerRight}>
          <SourceTag source={watch.live ? 'live' : 'sample'} noun="stream" />
          <View style={[styles.statPill, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
            <Ionicons name="eye" size={13} color="#FFF" />
            <Text variant="caption" tone="onDark">
              {formatCount(viewers)}
            </Text>
          </View>
          <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Title */}
      <View style={[styles.titleRow, { top: insets.top + 56 }]}>
        <Text variant="label" tone="onDark" numberOfLines={1}>
          {stream.title}
        </Text>
      </View>

      {/* Guests */}
      {stream.guests?.length ? (
        <View style={[styles.guestStrip, { top: insets.top + 90 }]}>
          {stream.guests.map((guest) => (
            <View key={guest.id} style={[styles.guestTile, { borderColor: theme.colors.accent }]}>
              <Image
                source={{ uri: `https://picsum.photos/seed/lguest${guest.id}/200/300` }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              <View style={styles.guestLabel}>
                <Text variant="caption" tone="onDark" numberOfLines={1}>
                  {guest.displayName.split(' ')[0]}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Gift animation */}
      {sentGift ? (
        <Animated.View
          style={[styles.giftBurst, { transform: [{ scale: giftScale }], opacity: giftScale }]}
          pointerEvents="none"
        >
          <Text style={styles.giftGlyph}>{sentGift.gift.icon}</Text>
          <Text variant="h3" tone="onDark">
            x{sentGift.quantity}
          </Text>
        </Animated.View>
      ) : null}

      {/* Floating heart */}
      <Animated.View
        style={[
          styles.floatingHeart,
          { bottom: insets.bottom + 90, transform: [{ translateY: heartTranslate }], opacity: heartOpacity },
        ]}
        pointerEvents="none"
      >
        <Ionicons name="heart" size={28} color={theme.colors.brand} />
      </Animated.View>

      {/* Chat */}
      <View style={[styles.chat, { bottom: insets.bottom + 70 }]}>
        <LiveCommentStream
          height={200}
          {...(watch.live
            ? {
                comments: watch.comments.map((c) => ({
                  id: c.id,
                  author: {
                    ...sample.host,
                    id: c.author.id,
                    username: c.author.username,
                    displayName: c.author.displayName,
                    avatar: c.author.avatar ?? `https://i.pravatar.cc/150?u=${c.author.username}`,
                    verification: c.author.verificationTier,
                  },
                  text: c.body,
                  kind: 'comment' as const,
                  createdAt: c.createdAt,
                })),
              }
            : {})}
        />
      </View>

      {giftError ? (
        <View style={[styles.giftError, { bottom: insets.bottom + 130 }]}>
          <Text variant="caption" tone="onDark">
            {giftError}
          </Text>
        </View>
      ) : null}

      {watch.ended ? (
        <View style={[styles.giftError, { bottom: insets.bottom + 170 }]}>
          <Text variant="caption" tone="onDark">
            {watch.ended}
          </Text>
        </View>
      ) : null}

      {/* Composer */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.composerWrap, { paddingBottom: insets.bottom + 12 }]}
      >
        <View style={[styles.composer, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Say something nice"
            placeholderTextColor="rgba(255,255,255,0.55)"
            style={[theme.typography.body, styles.input]}
          />
          {comment.trim() ? (
            <Pressable onPress={submitComment} hitSlop={theme.layout.hitSlop}>
              <Ionicons name="send" size={18} color="#FFF" />
            </Pressable>
          ) : null}
        </View>

        <Pressable onPress={() => setMenuOpen(true)} style={styles.iconButton} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="share-social-outline" size={22} color="#FFF" />
        </Pressable>

        <Pressable onPress={() => setGiftOpen(true)} haptic style={styles.iconButton}>
          <Ionicons name="gift" size={24} color={theme.colors.gold} />
        </Pressable>

        <Pressable onPress={sendLike} haptic style={styles.iconButton}>
          <Ionicons name="heart" size={24} color={theme.colors.brand} />
          <Text variant="caption" tone="onDark">
            {formatCount(likes)}
          </Text>
        </Pressable>
      </KeyboardAvoidingView>

      <GiftSheet
        visible={giftOpen}
        onClose={() => setGiftOpen(false)}
        onSend={sendGift}
        onTopUp={() => {
          setGiftOpen(false);
          navigation.navigate('BuyCoins');
        }}
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Options" height={0.45} showClose>
        <ListRow label="Share live" icon="share-social-outline" onPress={() => setMenuOpen(false)} />
        <ListRow label="Copy link" icon="link-outline" onPress={() => setMenuOpen(false)} />
        <ListRow label="Turn off comments for me" icon="eye-off-outline" onPress={() => setMenuOpen(false)} />
        <ListRow label="Not interested" icon="hand-left-outline" onPress={() => setMenuOpen(false)} />
        <ListRow label="Report live" icon="flag-outline" danger onPress={() => setMenuOpen(false)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  giftError: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    padding: 10,
  },
  root: { flex: 1, backgroundColor: '#000' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 360 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 10,
  },
  hostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 5,
    paddingRight: 8,
    borderRadius: 999,
    flexShrink: 1,
  },
  hostInfo: { maxWidth: 120 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  titleRow: { position: 'absolute', left: 14, right: 60 },
  guestStrip: { position: 'absolute', right: 12, gap: 8 },
  guestTile: { width: 78, height: 112, borderRadius: 12, overflow: 'hidden', borderWidth: 2 },
  guestLabel: { position: 'absolute', bottom: 4, left: 4, right: 4 },
  giftBurst: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  giftGlyph: { fontSize: 68 },
  floatingHeart: { position: 'absolute', right: 26 },
  chat: { position: 'absolute', left: 0, right: 96 },
  composerWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  composer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  input: { flex: 1, color: '#FFFFFF' },
  iconButton: { alignItems: 'center', minWidth: 30 },
});
