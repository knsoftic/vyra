import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Pressable } from '../../components';
import { VerticalFeed } from '../../components/feed/VerticalFeed';
import { useTheme } from '../../theme';
import { useResponsive } from '../../hooks/useResponsive';
import { useFeed, type FeedTab } from '../../hooks/useFeed';
import { useEventQueue } from '../../hooks/useEventQueue';
import { useApp } from '../../store/AppState';
import type { TabScreenProps } from '../../navigation/types';

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'following', label: 'Following' },
  { id: 'for_you', label: 'For You' },
  { id: 'trending', label: 'Trending' },
];

export function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsive();
  const [tab, setTab] = useState<FeedTab>('for_you');
  const { videos, source, refreshing, ranker, refresh } = useFeed(tab);
  const { track } = useEventQueue();
  const { syncEngagement } = useApp();

  /**
   * Ask once per page which of these the viewer already liked or saved.
   *
   * Without this the hearts start empty on every launch, so a video you liked
   * yesterday looks unliked today — the state was on the server all along, the
   * screen just never asked for it.
   */
  useEffect(() => {
    if (source !== 'live' || videos.length === 0) return;
    syncEngagement(videos.map((video) => video.id));
  }, [videos, source, syncEngagement]);

  /**
   * Emits the exposure signal for whatever the viewer is currently looking at.
   *
   * Only the impression is sent from here. Watch duration belongs to the player,
   * which is the only thing that knows how long a video actually played — and
   * the server decides what that duration *means* (ADR-009), so the client
   * never claims a video was "watched".
   */
  const lastTracked = useRef<string | null>(null);
  const handleActiveChange = useCallback(
    (video: { id: string } | undefined) => {
      if (!video || source !== 'live') return;
      if (lastTracked.current === video.id) return;
      lastTracked.current = video.id;
      track('impression', { videoId: video.id, feedSource: 'for_you' });
    },
    [track, source],
  );

  const handleRefresh = () => {
    void refresh();
  };

  const pills = (
    <View style={[styles.pillGroup, isDesktop && styles.pillGroupDesktop]}>
      {TABS.map((item) => {
        const active = tab === item.id;
        return (
          <Pressable
            key={item.id}
            onPress={() => setTab(item.id)}
            haptic
            style={[styles.pill, active && { backgroundColor: theme.colors.brand }]}
          >
            <Text
              variant="label"
              style={{
                color: active
                  ? '#FFFFFF'
                  : isDesktop
                    ? theme.colors.textSecondary
                    : 'rgba(255,255,255,0.75)',
                fontWeight: active ? '700' : '500',
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  // ── Desktop web: the feed sits inside the app shell, with a normal header bar ──

  /**
   * Says where the videos came from.
   *
   * Sample data that looks live is the most misleading thing this screen could
   * do, so the distinction is shown rather than hidden — including which ranker
   * served a live feed, since the rules ranker means the model is unavailable.
   */
  const sourceBadge = (
    <View
      style={[
        styles.sourceBadge,
        {
          backgroundColor:
            source === 'live' ? 'rgba(61,220,151,0.16)' : 'rgba(255,176,32,0.16)',
        },
      ]}
    >
      <View
        style={[
          styles.sourceDot,
          { backgroundColor: source === 'live' ? theme.colors.accent : theme.colors.gold },
        ]}
      />
      <Text variant="caption" style={{ color: source === 'live' ? theme.colors.accent : theme.colors.gold }}>
        {source === 'live' ? `Live${ranker ? ` · ${ranker}` : ''}` : 'Sample data'}
      </Text>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopRoot, { backgroundColor: theme.colors.bg }]}>
        <View style={[styles.desktopHeader, { borderBottomColor: theme.colors.border }]}>
          {pills}
          <View style={styles.headerActions}>
            {sourceBadge}
            <Pressable
              onPress={() => navigation.navigate('LiveList')}
              style={[styles.desktopIcon, { backgroundColor: theme.colors.surfaceAlt }]}
            >
              <Ionicons name="radio-outline" size={18} color={theme.colors.text} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Search')}
              style={[styles.desktopIcon, { backgroundColor: theme.colors.surfaceAlt }]}
            >
              <Ionicons name="search" size={18} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        <VerticalFeed
          key={tab}
          videos={videos}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onActiveChange={handleActiveChange}
          emptyTitle={tab === 'following' ? 'No videos from people you follow' : 'Nothing here yet'}
          emptyDescription={
            tab === 'following'
              ? 'Follow a few creators and their newest videos will appear here first.'
              : undefined
          }
        />
      </View>
    );
  }

  // ── Mobile: full-bleed feed with a floating header ──
  return (
    <View style={styles.root}>
      <VerticalFeed
        key={tab}
        videos={videos}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onActiveChange={handleActiveChange}
        emptyTitle={tab === 'following' ? 'No videos from people you follow' : 'Nothing here yet'}
        emptyDescription={
          tab === 'following'
            ? 'Follow a few creators and their newest videos will appear here first.'
            : undefined
        }
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {pills}

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => navigation.navigate('LiveList')}
            hitSlop={theme.layout.hitSlop}
            style={styles.headerIcon}
          >
            <Ionicons name="radio-outline" size={20} color="#FFF" />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('Search')}
            hitSlop={theme.layout.hitSlop}
            style={styles.headerIcon}
          >
            <Ionicons name="search" size={20} color="#FFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  pillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  pillGroupDesktop: { backgroundColor: 'transparent', padding: 0, gap: 4 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  desktopRoot: { flex: 1 },
  desktopHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  desktopIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
