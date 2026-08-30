import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Pressable, Chip, Badge, EmptyState } from '../../components';
import { EditorPreview } from '../../components/create/EditorPreview';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useContentWidth } from '../../hooks/useResponsive';
import { useApiData } from '../../hooks/useApiData';
import { creative } from '../../api';
import { stickerPacks } from '../../mock';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

const COLUMNS = 6;

export function StickersScreen({ navigation }: RootScreenProps<'Stickers'>) {
  const theme = useTheme();
  const TILE = (useContentWidth() - 16 * 2 - 8 * (COLUMNS - 1)) / COLUMNS;
  const { compose, setCompose } = useApp();
  const [packId, setPackId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Sticker packs are catalogue content, so an admin adding a pack has to reach
  // the app without a release — the same rule the filters and effects follow.
  const { data: catalogue, source } = useApiData(() => creative.catalogue(), null, [], {
    requiresAuth: false,
  });

  // The server gives each sticker a label; the sample data is bare emoji. Both
  // are normalised so the grid and the search below do not care which they got.
  const packs =
    source === 'live' && catalogue
      ? catalogue.stickerPacks.map((p) => ({
          id: p.slug,
          name: p.name,
          isNew: p.isNew,
          // A catalogue sticker is either an emoji or an image. This grid draws
          // text, so image packs are skipped rather than rendered as a blank
          // tile; they arrive when the editor can composite them.
          stickers: p.stickers
            .filter((st): st is typeof st & { emoji: string } => typeof st.emoji === 'string')
            .map((st) => ({ id: st.id, emoji: st.emoji, label: st.label })),
        }))
      : stickerPacks.map((p) => ({
          id: p.id,
          name: p.name,
          isNew: p.isNew ?? false,
          stickers: p.stickers.map((emoji, index) => ({
            id: `${p.id}_${index}`,
            emoji,
            label: '',
          })),
        }));

  const pack = packs.find((p) => p.id === packId) ?? packs[0];
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? packs
        .flatMap((p) => p.stickers)
        .filter((st) => st.label.toLowerCase().includes(needle))
    : (pack?.stickers ?? []);

  const addSticker = (emoji: string) => {
    setCompose({
      stickers: [...compose.stickers, { id: `sticker_${Date.now()}`, emoji }],
    });
  };

  const removeLast = () => setCompose({ stickers: compose.stickers.slice(0, -1) });

  return (
    <Screen dark background="#0A0A0B">
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Text variant="bodyStrong" tone="onDark">
          Stickers
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Text variant="labelStrong" tone="brand">
            Done
          </Text>
        </Pressable>
      </View>

      <View style={styles.previewWrap}>
        <EditorPreview />
        {compose.stickers.length > 0 ? (
          <Pressable
            onPress={removeLast}
            style={[styles.undoButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
          >
            <Ionicons name="backspace-outline" size={16} color="#FFF" />
            <Text variant="caption" tone="onDark">
              Remove last
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.searchWrap, { paddingHorizontal: theme.spacing.md }]}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search stickers"
            placeholderTextColor="rgba(255,255,255,0.4)"
            style={[theme.typography.body, { color: '#FFF', flex: 1 }]}
          />
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs, alignItems: 'flex-start' }}>
        <SourceTag source={source} noun="sticker packs" />
      </View>

      {!query ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={[styles.packs, { paddingHorizontal: theme.spacing.md }]}
        >
          {packs.map((item) => (
            <View key={item.id} style={styles.packItem}>
              <Chip
                label={item.name}
                size="sm"
                tone="brand"
                selected={(pack?.id ?? null) === item.id}
                onPress={() => setPackId(item.id)}
              />
              {item.isNew ? <Badge label="New" tone="accent" size="sm" style={styles.packBadge} /> : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.grid, { paddingHorizontal: theme.spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        {visible.length === 0 ? (
          <EmptyState icon="happy-outline" title="No stickers found" compact />
        ) : (
          visible.map((sticker, index) => (
            <Pressable
              key={`${sticker.id}-${index}`}
              onPress={() => addSticker(sticker.emoji)}
              accessibilityLabel={sticker.label || sticker.emoji}
              haptic
              style={[
                styles.stickerTile,
                {
                  width: TILE,
                  height: TILE,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text style={styles.emoji}>{sticker.emoji}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0, flexShrink: 0 },
  topBar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewWrap: { height: 210, margin: 16, marginTop: 4 },
  undoButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  searchWrap: { paddingBottom: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12 },
  packs: { gap: 8, paddingBottom: 10 },
  packItem: {},
  packBadge: { position: 'absolute', top: -6, right: -4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 24 },
  stickerTile: { alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22 },
});
