import React, { useState, useRef, useCallback } from 'react';
import { View, FlatList, ViewToken, RefreshControl, LayoutChangeEvent } from 'react-native';
import { FeedVideoItem } from './FeedVideoItem';
import { CommentsSheet } from './CommentsSheet';
import { ShareSheet } from './ShareSheet';
import { EmptyState } from '../Lists';
import { useResponsive } from '../../hooks/useResponsive';
import { Video } from '../../types';

interface VerticalFeedProps {
  videos: Video[];
  initialIndex?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Called when the visible video changes, so the screen can emit a signal. */
  onActiveChange?: (video: Video) => void;
}

/**
 * The snap-scrolling vertical feed used by For You, Following, Trending,
 * category feeds and the single-video player.
 *
 * The page height is **measured from the container**, never computed from
 * `Dimensions`. Computing it was a real bug: the window height minus a guessed
 * tab-bar height did not match the actual viewport, so every page was slightly
 * too tall and the absolutely-positioned overlay (author, caption, action bar)
 * drifted below the fold as you scrolled.
 *
 * Snapping uses `pagingEnabled` alone. Combining it with `snapToInterval` made
 * the two fight, because paging snaps to the container while the interval
 * snapped to the computed value.
 *
 * Only the active item and its immediate neighbours load video — the same
 * preload window the production player will use (PHASE_05).
 */
export function VerticalFeed({
  videos,
  initialIndex = 0,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRefresh,
  refreshing = false,
  onActiveChange,
}: VerticalFeedProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [muted, setMuted] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Video | null>(null);
  const [shareFor, setShareFor] = useState<Video | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const { isDesktop } = useResponsive();

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Held in a ref so the identity is stable: FlatList throws if
  // onViewableItemsChanged changes between renders.
  const activeChangeRef = useRef(onActiveChange);
  activeChangeRef.current = onActiveChange;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) {
        setActiveIndex(first.index);
        activeChangeRef.current?.(first.item as Video);
      }
    },
  ).current;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    // Ignore sub-pixel jitter so the list is not rebuilt on every resize frame.
    setPageHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  const getItemLayout = useCallback(
    (_: ArrayLike<Video> | null | undefined, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight],
  );

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {videos.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState icon="videocam-outline" title={emptyTitle} description={emptyDescription} />
        </View>
      ) : pageHeight > 0 ? (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={2}
          removeClippedSubviews={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFF" />
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <FeedVideoItem
              video={item}
              height={pageHeight}
              isActive={index === activeIndex}
              shouldLoad={Math.abs(index - activeIndex) <= 1}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onOpenComments={setCommentsFor}
              onOpenShare={setShareFor}
              wide={isDesktop}
            />
          )}
        />
      ) : null}

      <CommentsSheet
        video={commentsFor}
        visible={commentsFor !== null}
        onClose={() => setCommentsFor(null)}
      />
      <ShareSheet
        video={shareFor}
        visible={shareFor !== null}
        onClose={() => setShareFor(null)}
      />
    </View>
  );
}
