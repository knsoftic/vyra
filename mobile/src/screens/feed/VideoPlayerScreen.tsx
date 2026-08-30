import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from '../../components';
import { VerticalFeed } from '../../components/feed/VerticalFeed';
import { videos } from '../../mock';
import type { RootScreenProps } from '../../navigation/types';

/** Deep-linked single video. Swiping continues into the surrounding feed. */
export function VideoPlayerScreen({ navigation, route }: RootScreenProps<'VideoPlayer'>) {
  const insets = useSafeAreaInsets();
  const { videoId } = route.params;

  const initialIndex = useMemo(() => {
    const index = videos.findIndex((v) => v.id === videoId);
    return index >= 0 ? index : 0;
  }, [videoId]);

  return (
    <View style={styles.root}>
      <VerticalFeed videos={videos} initialIndex={initialIndex} />

      <Pressable
        onPress={() => navigation.goBack()}
        style={[styles.back, { top: insets.top + 8 }]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="chevron-back" size={26} color="#FFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  back: {
    position: 'absolute',
    left: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
