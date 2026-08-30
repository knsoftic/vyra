import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { filters } from '../../mock';

/**
 * Shared preview surface for the editor screens.
 *
 * Phase 1 approximates the look with a tint layer plus opacity derived from the
 * adjustment values. Phase 4 replaces this single component with the GPU shader
 * pipeline — every screen around it stays unchanged.
 */
export function EditorPreview({
  children,
  style,
  showFilterName = false,
  overrideFilterId,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  showFilterName?: boolean;
  overrideFilterId?: string;
}) {
  const theme = useTheme();
  const { compose } = useApp();

  // An override is only used by the filter carousel, which passes a sample id;
  // everything else reads the appearance the picker stored.
  const override = overrideFilterId ? filters.find((f) => f.id === overrideFilterId) : undefined;
  const filterColor = override?.previewColor ?? compose.filterColor;
  const filterIntensity = override?.intensity ?? compose.filterIntensity;
  const filterName = override?.name ?? compose.filterName;

  const firstClip = compose.clips[0];
  const poster = firstClip?.thumb ?? 'https://picsum.photos/seed/preview/540/960';

  const { brightness = 0, contrast = 0, vignette = 0, fade = 0 } = compose.adjustments;

  return (
    <View style={[styles.root, { backgroundColor: '#000', borderRadius: theme.radius.md }, style]}>
      <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />

      {/* Filter tint */}
      {filterColor !== 'transparent' ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: filterColor, opacity: filterIntensity / 100 },
          ]}
        />
      ) : null}

      {/* Brightness / fade approximation */}
      {brightness !== 0 ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: brightness > 0 ? '#FFFFFF' : '#000000',
              opacity: Math.abs(brightness) / 320,
            },
          ]}
        />
      ) : null}
      {fade > 0 ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#8A8A93', opacity: fade / 380 }]} />
      ) : null}
      {contrast !== 0 ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: contrast > 0 ? '#000000' : '#7A7A80', opacity: Math.abs(contrast) / 500 },
          ]}
        />
      ) : null}

      {/* Vignette approximation */}
      {vignette > 0 ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.vignette,
            { borderColor: `rgba(0,0,0,${Math.min(0.75, vignette / 130)})` },
          ]}
          pointerEvents="none"
        />
      ) : null}

      {/* Active effects marker */}
      {compose.effectIds.length > 0 ? (
        <View style={styles.effectTag}>
          <Ionicons name="color-wand" size={11} color="#FFF" />
          <Text variant="caption" tone="onDark">
            {compose.effectIds.length} effect{compose.effectIds.length === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}

      {/* Text overlays */}
      {compose.textOverlays.map((overlay, index) => (
        <View key={overlay.id} style={[styles.overlayText, { top: 60 + index * 40 }]}>
          <Text variant="h3" style={{ color: overlay.color }}>
            {overlay.text}
          </Text>
        </View>
      ))}

      {/* Stickers */}
      {compose.stickers.map((sticker, index) => (
        <View key={sticker.id} style={[styles.sticker, { top: 120 + index * 46, left: 24 + index * 34 }]}>
          <Text style={styles.stickerGlyph}>{sticker.emoji}</Text>
        </View>
      ))}

      {showFilterName && filterColor !== 'transparent' ? (
        <View style={styles.filterTag}>
          <Text variant="caption" tone="onDark">
            {filterName}
          </Text>
        </View>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  vignette: { borderWidth: 40, borderRadius: 90 },
  effectTag: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  filterTag: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  overlayText: { position: 'absolute', alignSelf: 'center' },
  sticker: { position: 'absolute' },
  stickerGlyph: { fontSize: 28 },
});
