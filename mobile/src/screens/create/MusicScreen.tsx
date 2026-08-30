import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, FlatList, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Chip,
  Badge,
  Sheet,
  EmptyState,
  Divider,
} from '../../components';
import { Slider } from '../../components/Controls';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { musicLibrary, musicCategories, trendingMusic, favoriteMusic } from '../../mock';
import { useApiData } from '../../hooks/useApiData';
import { music as musicApi, type MusicTrack } from '../../api';
import { formatCount, formatDuration } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';
import type { Sound } from '../../types';

type MusicTab = 'trending' | 'new' | 'categories' | 'favourites';

export function MusicScreen({ navigation }: RootScreenProps<'Music'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  const [tab, setTab] = useState<MusicTab>('trending');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(musicCategories[0]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [trimming, setTrimming] = useState<Sound | null>(null);
  const [trimStart, setTrimStart] = useState(0);

  /**
   * The real music library.
   *
   * Favourites are per-user and stored server-side, so a track saved on one
   * device is saved on all of them.
   */
  const { data: liveTracks, source, refresh: refreshTracks } = useApiData<MusicTrack[]>(
    () =>
      musicApi.list({
        ...(query ? { q: query } : {}),
        ...(tab === 'trending' ? { trending: true } : {}),
        ...(tab === 'favourites' ? { favourites: true } : {}),
        ...(tab === 'categories' && category ? { category } : {}),
      }),
    [],
    [query, tab, category],
  );

  const toSound = (track: MusicTrack): Sound => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.coverUrl ?? `https://picsum.photos/seed/${track.id}/200/200`,
    durationSec: track.durationSec,
    isOriginal: false,
    // These were being dropped, so a live row could never show the trending
    // badge or the favourite it actually has on the account.
    usageCount: track.usageCount,
    category: track.category,
    isTrending: track.isTrending,
    isFavorite: track.isFavourite ?? false,
  });

  const list = useMemo(() => {
    // A live search is served by the server, which matches title and artist the
    // same way; falling back to the sample library here would hide real tracks.
    if (query && source === 'live' && liveTracks.length > 0) return liveTracks.map(toSound);
    if (query) {
      const needle = query.toLowerCase();
      return musicLibrary.filter(
        (sound) =>
          sound.title.toLowerCase().includes(needle) ||
          sound.artist.toLowerCase().includes(needle),
      );
    }
    // Live results win whenever the server returned any.
    if (source === 'live' && liveTracks.length > 0) return liveTracks.map(toSound);

    if (tab === 'trending') return trendingMusic;
    if (tab === 'favourites') return favoriteMusic;
    if (tab === 'new') return [...musicLibrary].reverse().slice(0, 8);
    return musicLibrary.filter((sound) =>
      category === 'Trending' ? sound.isTrending : sound.category === category,
    );
    // `source` and `liveTracks` belong here: without them the memo is computed
    // once against the empty initial data and never recomputed when the request
    // resolves, so the live library is fetched and then silently discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, category, source, liveTracks]);

  /**
   * Favourites belong to the account, not to the device.
   *
   * The button was rendering the state and doing nothing on press. Writing it
   * server-side is what makes a track saved on a phone also saved on the web,
   * which is the only reason the field exists.
   */
  const toggleFavourite = async (sound: Sound) => {
    if (source !== 'live') return;
    try {
      await (sound.isFavorite ? musicApi.unfavourite(sound.id) : musicApi.favourite(sound.id));
      await refreshTracks();
    } catch {
      // Left as it was; the next load shows whatever the server holds.
    }
  };

  const selectSound = (sound: Sound) => {
    setCompose({ sound });
    setTrimming(sound);
  };

  const confirmSound = () => {
    setTrimming(null);
    navigation.goBack();
  };

  return (
    <Screen>
      <Header
        title="Add sound"
        right={
          <Pressable onPress={() => navigation.navigate('Voiceover')} hitSlop={theme.layout.hitSlop}>
            <Text variant="label" tone="brand">
              Voiceover
            </Text>
          </Pressable>
        }
      />

      {/* Search */}
      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="search" size={16} color={theme.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search music and sounds"
            placeholderTextColor={theme.colors.textMuted}
            style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={theme.layout.hitSlop}>
              <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ paddingTop: theme.spacing.xs, alignItems: 'flex-start' }}>
          <SourceTag source={source} noun="library" />
        </View>
      </View>

      {/* Original sound option */}
      <Pressable
        onPress={() => {
          setCompose({ sound: undefined });
          navigation.goBack();
        }}
        style={[
          styles.originalRow,
          { backgroundColor: theme.colors.surface, marginHorizontal: theme.spacing.md, borderRadius: theme.radius.md },
        ]}
      >
        <View style={[styles.originalIcon, { backgroundColor: theme.colors.brandSoft }]}>
          <Ionicons name="mic-outline" size={20} color={theme.colors.brand} />
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong">Keep original sound</Text>
          <Text variant="caption" tone="muted">
            Use the audio recorded with your clips
          </Text>
        </View>
        {!compose.sound ? <Ionicons name="checkmark" size={18} color={theme.colors.brand} /> : null}
      </Pressable>

      {!query ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
            contentContainerStyle={[styles.tabs, { paddingHorizontal: theme.spacing.md }]}
          >
            {(
              [
                { id: 'trending', label: 'Trending' },
                { id: 'new', label: 'New' },
                { id: 'categories', label: 'Categories' },
                { id: 'favourites', label: 'Favourites' },
              ] as const
            ).map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                selected={tab === item.id}
                onPress={() => setTab(item.id)}
              />
            ))}
          </ScrollView>

          {tab === 'categories' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={[styles.tabs, { paddingHorizontal: theme.spacing.md }]}
            >
              {musicCategories.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  size="sm"
                  tone="brand"
                  selected={category === item}
                  onPress={() => setCategory(item)}
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <Divider inset={72} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <EmptyState
            icon="musical-notes-outline"
            title="No sounds found"
            description={query ? `Nothing matched "${query}".` : 'Try another category.'}
          />
        }
        renderItem={({ item }) => {
          const isPlaying = playing === item.id;
          const isSelected = compose.sound?.id === item.id;
          return (
            <Pressable
              onPress={() => selectSound(item)}
              style={[styles.soundRow, { paddingHorizontal: theme.spacing.md }]}
            >
              <Pressable
                onPress={() => setPlaying(isPlaying ? null : item.id)}
                style={styles.coverWrap}
              >
                <Image
                  source={{ uri: item.cover }}
                  style={[styles.cover, { borderRadius: theme.radius.sm }]}
                  contentFit="cover"
                />
                <View style={styles.playOverlay}>
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color="#FFF" />
                </View>
              </Pressable>

              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                    {item.title}
                  </Text>
                  {item.isTrending ? <Badge label="Hot" tone="brand" size="sm" /> : null}
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {item.artist} · {formatDuration(item.durationSec)} ·{' '}
                  {formatCount(item.usageCount ?? 0)} videos
                </Text>
              </View>

              <Pressable
                hitSlop={theme.layout.hitSlop}
                onPress={() => void toggleFavourite(item)}
              >
                <Ionicons
                  name={item.isFavorite ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={item.isFavorite ? theme.colors.gold : theme.colors.textMuted}
                />
              </Pressable>

              {isSelected ? (
                <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
              ) : null}
            </Pressable>
          );
        }}
      />

      {/* Trim sheet */}
      <Sheet
        visible={trimming !== null}
        onClose={() => setTrimming(null)}
        title={trimming?.title}
        subtitle={trimming?.artist}
        height={0.45}
        showClose
      >
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.lg }}>
          <View>
            <View style={styles.trimHeader}>
              <Text variant="label" tone="secondary">
                Start at
              </Text>
              <Text variant="label">{formatDuration(trimStart)}</Text>
            </View>
            <Slider
              value={trimStart}
              min={0}
              max={Math.max(1, (trimming?.durationSec ?? 30) - 5)}
              onChange={setTrimStart}
            />
            <View style={styles.waveform}>
              {Array.from({ length: 40 }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.waveBar,
                    {
                      height: 6 + ((index * 13) % 26),
                      backgroundColor:
                        index / 40 >= trimStart / (trimming?.durationSec ?? 30)
                          ? theme.colors.brand
                          : theme.colors.borderStrong,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View>
            <View style={styles.trimHeader}>
              <Text variant="label" tone="secondary">
                Music volume
              </Text>
              <Text variant="label">{compose.volumes.music}</Text>
            </View>
            <Slider
              value={compose.volumes.music}
              onChange={(value) => setCompose({ volumes: { ...compose.volumes, music: value } })}
            />
          </View>

          <View>
            <View style={styles.trimHeader}>
              <Text variant="label" tone="secondary">
                Original audio volume
              </Text>
              <Text variant="label">{compose.volumes.original}</Text>
            </View>
            <Slider
              value={compose.volumes.original}
              onChange={(value) => setCompose({ volumes: { ...compose.volumes, original: value } })}
            />
          </View>

          <Button label="Use this sound" variant="gradient" fullWidth onPress={confirmSound} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0, flexShrink: 0 },
  flex: { flex: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12 },
  originalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 12 },
  originalIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabs: { gap: 8, paddingBottom: 12 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  coverWrap: { width: 48, height: 48 },
  cover: { width: 48, height: 48 },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trimHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 10, height: 32 },
  waveBar: { flex: 1, borderRadius: 1 },
});
