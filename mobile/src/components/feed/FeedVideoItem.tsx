import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Avatar, VerifiedBadge } from '../Avatar';
import { Badge } from '../Cards';
import { useTheme } from '../../theme';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import { Video } from '../../types';

interface FeedVideoItemProps {
  video: Video;
  height: number;
  isActive: boolean;
  /** True for the active item and its immediate neighbours — mirrors the real preload window. */
  shouldLoad: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenComments: (video: Video) => void;
  onOpenShare: (video: Video) => void;
  /** Desktop web: centred video column with actions beside it, not full-bleed. */
  wide?: boolean;
}

/** Three-bar equalizer that pulses while the video plays. */
function Equalizer({ playing, color }: { playing: boolean; color: string }) {
  const bars = [
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(1)).current,
    useRef(new Animated.Value(0.6)).current,
  ];

  useEffect(() => {
    if (!playing) {
      bars.forEach((bar) => bar.stopAnimation());
      return;
    }
    const loops = bars.map((bar, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 380 + index * 120,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: 0.35,
            duration: 380 + index * 120,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <View style={styles.equalizer}>
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={[styles.equalizerBar, { backgroundColor: color, transform: [{ scaleY: bar }] }]}
        />
      ))}
    </View>
  );
}

export function FeedVideoItem({
  video,
  height,
  isActive,
  shouldLoad,
  muted,
  onToggleMute,
  onOpenComments,
  onOpenShare,
  wide = false,
}: FeedVideoItemProps) {
  const theme = useTheme();
  const navigation = useNavigation();
  const { isLiked, isSaved, isFollowing, toggleLike, toggleSave, toggleFollow } = useApp();

  const [paused, setPaused] = useState(false);
  const [expandedCaption, setExpandedCaption] = useState(false);

  const liked = isLiked(video);
  const saved = isSaved(video);
  const following = isFollowing(video.author);

  // A video whose render has not finished yet has no playable URL. Passing an
  // empty string as a source makes the browser re-request the whole page, so
  // the player is given null and the poster carries the frame instead.
  const playableUrl = video.url && video.url.length > 0 ? video.url : null;

  const player = useVideoPlayer(shouldLoad && playableUrl ? { uri: playableUrl } : null, (instance) => {
    instance.loop = true;
    instance.muted = muted;
  });

  useEffect(() => {
    // Same reason as below: a released player throws on property access, and
    // the mute state is not worth crashing a screen over.
    try {
      player.muted = muted;
    } catch {
      // Player already gone; the next mount reads `muted` in its setup.
    }
  }, [muted, player]);

  useEffect(() => {
    // `playableUrl` is checked as well as `shouldLoad`: a video whose render has
    // not finished has a null source, and on native, calling play() on a player
    // with no source crashes the app rather than doing nothing. On web it was
    // silently harmless, which is why this survived until a real device ran it.
    if (!shouldLoad || !playableUrl) return;
    try {
      if (isActive && !paused) player.play();
      else player.pause();
    } catch {
      // A player released mid-scroll. The poster still shows the frame, and a
      // playback failure must never take the feed down with it.
    }
  }, [isActive, paused, shouldLoad, playableUrl, player]);

  // ── Double-tap to like, single tap to pause ──
  const lastTap = useRef(0);
  const heartScale = useRef(new Animated.Value(0)).current;

  const burstHeart = useCallback(() => {
    heartScale.setValue(0);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, friction: 4 }),
      Animated.timing(heartScale, { toValue: 0, duration: 320, delay: 380, useNativeDriver: true }),
    ]).start();
  }, [heartScale]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (!liked) toggleLike(video.id);
      burstHeart();
      return;
    }
    lastTap.current = now;
    setTimeout(() => {
      if (lastTap.current !== 0 && Date.now() - lastTap.current >= 280) {
        setPaused((p) => !p);
        lastTap.current = 0;
      }
    }, 290);
  }, [liked, toggleLike, video.id, burstHeart]);

  const actions = [
    {
      id: 'like',
      icon: liked ? ('heart' as const) : ('heart-outline' as const),
      color: liked ? theme.colors.brand : '#FFFFFF',
      count: video.stats.likes + (liked && !video.liked ? 1 : 0),
      label: 'Like',
      onPress: () => {
        toggleLike(video.id);
        if (!liked) burstHeart();
      },
    },
    {
      id: 'comment',
      icon: 'chatbubble-outline' as const,
      color: '#FFFFFF',
      count: video.stats.comments,
      label: 'Comments',
      onPress: () => onOpenComments(video),
      disabled: !video.interaction.allowComments,
    },
    {
      id: 'save',
      icon: saved ? ('bookmark' as const) : ('bookmark-outline' as const),
      color: saved ? theme.colors.gold : '#FFFFFF',
      count: video.stats.saves,
      label: 'Save',
      onPress: () => toggleSave(video.id),
    },
    {
      id: 'share',
      icon: 'paper-plane-outline' as const,
      color: '#FFFFFF',
      count: video.stats.shares,
      label: 'Share',
      onPress: () => onOpenShare(video),
    },
  ];

  // ── Shared pieces ──

  const media = (
    <>
      {/* Poster is always painted underneath so there is never a black frame. */}
      <Image
        source={{ uri: video.poster }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />

      {shouldLoad ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      ) : null}

      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} activeOpacity={1}>
        <LinearGradient
          colors={['rgba(0,0,0,0.4)', 'transparent']}
          style={styles.topGradient}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.82)']}
          style={styles.bottomGradient}
          pointerEvents="none"
        />
      </Pressable>

      {paused ? (
        <View style={styles.pauseWrap} pointerEvents="none">
          <View style={styles.pauseCircle}>
            <Ionicons name="play" size={30} color="#FFFFFF" />
          </View>
        </View>
      ) : null}

      <Animated.View
        style={[styles.heartBurst, { transform: [{ scale: heartScale }], opacity: heartScale }]}
        pointerEvents="none"
      >
        <Ionicons name="heart" size={84} color={theme.colors.brand} />
      </Animated.View>

      <Pressable onPress={onToggleMute} style={styles.muteButton} hitSlop={theme.layout.hitSlop}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={14} color="#FFF" />
      </Pressable>
    </>
  );

  const authorRow = (
    <View style={styles.authorRow}>
      <Pressable
        onPress={() => navigation.navigate('Profile', { userId: video.author.id })}
        style={styles.authorLeft}
      >
        <Avatar uri={video.author.avatar} size={30} />
        <View style={styles.authorText}>
          <View style={styles.nameRow}>
            <Text variant="labelStrong" tone="onDark" numberOfLines={1}>
              {video.author.displayName}
            </Text>
            <VerifiedBadge tier={video.author.verification} size={12} />
          </View>
          <Text variant="caption" style={styles.handle} numberOfLines={1}>
            @{video.author.username}
          </Text>
        </View>
      </Pressable>

      {!following ? (
        <Pressable
          onPress={() => toggleFollow(video.author.id)}
          haptic
          style={[styles.followChip, { borderColor: theme.colors.brand }]}
        >
          <Text variant="caption" style={{ color: theme.colors.brand, fontWeight: '700' }}>
            Follow
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const captionBlock = (
    <>
      <Pressable onPress={() => setExpandedCaption((e) => !e)}>
        <Text
          variant="label"
          tone="onDark"
          numberOfLines={expandedCaption ? undefined : 2}
          style={styles.caption}
        >
          {video.caption}
          {video.hashtags.length ? (
            <Text variant="label" style={{ color: theme.colors.accent }}>
              {' '}
              {video.hashtags.map((tag) => `#${tag}`).join(' ')}
            </Text>
          ) : null}
        </Text>
      </Pressable>

      <View style={styles.metaRow}>
        <Pressable
          onPress={() => navigation.navigate('SoundDetail', { soundId: video.sound.id })}
          style={styles.soundPill}
        >
          <Equalizer playing={isActive && !paused} color={theme.colors.accent} />
          <Text variant="caption" tone="onDark" numberOfLines={1} style={styles.soundText}>
            {video.sound.isOriginal
              ? `original sound — ${video.sound.artist}`
              : `${video.sound.title} — ${video.sound.artist}`}
          </Text>
        </Pressable>

        {video.location ? (
          <View style={styles.locationPill}>
            <Ionicons name="location-outline" size={10} color="#FFF" />
            <Text variant="caption" tone="onDark" numberOfLines={1}>
              {video.location}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );

  // ── Desktop web: centred video column, actions in a rail beside it ──
  if (wide) {
    const cardHeight = Math.max(320, height - 48);
    const cardWidth = Math.min(cardHeight * (9 / 16), 460);

    return (
      <View style={[styles.wideRoot, { height, backgroundColor: theme.colors.bg }]}>
        <View style={styles.wideCentre}>
          <View
            style={[
              styles.wideCard,
              { width: cardWidth, height: cardHeight, borderRadius: theme.radius.xl },
            ]}
          >
            {media}

            <View style={styles.wideOverlay} pointerEvents="box-none">
              {video.isPromoted ? (
                <Badge label="SPONSORED" tone="neutral" size="sm" style={styles.sponsored} />
              ) : null}
              {authorRow}
              {captionBlock}
            </View>
          </View>

          {/* Vertical action rail — the desktop convention, beside the video rather than on it */}
          <View style={styles.wideRail}>
            {actions.map((action) => (
              <Pressable
                key={action.id}
                onPress={action.disabled ? undefined : action.onPress}
                haptic
                style={[styles.wideRailItem, action.disabled && styles.disabled]}
              >
                <View style={[styles.wideRailButton, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <Ionicons
                    name={action.icon}
                    size={20}
                    color={action.color === '#FFFFFF' ? theme.colors.text : action.color}
                  />
                </View>
                <Text variant="caption" tone="secondary">
                  {action.disabled ? 'Off' : formatCount(action.count)}
                </Text>
              </Pressable>
            ))}

            <Pressable onPress={() => onOpenShare(video)} haptic style={styles.wideRailItem}>
              <View style={[styles.wideRailButton, { backgroundColor: theme.colors.surfaceAlt }]}>
                <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text} />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── Mobile: full-bleed with the horizontal action bar ──
  return (
    <View style={{ height, backgroundColor: '#000' }}>
      {media}

      <View style={styles.bottom} pointerEvents="box-none">
        {video.isPromoted ? (
          <Badge label="SPONSORED" tone="neutral" size="sm" style={styles.sponsored} />
        ) : null}

        {authorRow}
        {captionBlock}

        <View style={styles.actionBar}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              onPress={action.disabled ? undefined : action.onPress}
              haptic
              style={[styles.action, action.disabled && styles.disabled]}
            >
              <Ionicons name={action.icon} size={19} color={action.color} />
              <Text variant="caption" tone="onDark" style={styles.actionCount}>
                {action.disabled ? 'Off' : formatCount(action.count)}
              </Text>
            </Pressable>
          ))}

          <View style={styles.actionDivider} />

          <Pressable
            onPress={() => onOpenShare(video)}
            haptic
            style={styles.action}
            accessibilityLabel="More options"
          >
            <Ionicons name="ellipsis-horizontal" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
  bottomGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 300 },
  pauseWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartBurst: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteButton: {
    position: 'absolute',
    right: 12,
    top: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Mobile overlay
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 16, gap: 8 },

  sponsored: { marginBottom: 2 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  authorText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  handle: { color: 'rgba(255,255,255,0.6)' },
  followChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  caption: { lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  soundPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: '78%',
  },
  soundText: { flexShrink: 1 },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  equalizer: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 12 },
  equalizerBar: { width: 2, height: 11, borderRadius: 1 },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 7,
    marginTop: 2,
    gap: 2,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11 },
  actionCount: { fontWeight: '600' },
  actionDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginHorizontal: 2,
  },
  disabled: { opacity: 0.45 },

  // Desktop layout
  wideRoot: { alignItems: 'center', justifyContent: 'center' },
  wideCentre: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  wideCard: { overflow: 'hidden', backgroundColor: '#000' },
  wideOverlay: { position: 'absolute', left: 14, right: 14, bottom: 16, gap: 8 },
  wideRail: { gap: 14, paddingBottom: 16 },
  wideRailItem: { alignItems: 'center', gap: 4 },
  wideRailButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
