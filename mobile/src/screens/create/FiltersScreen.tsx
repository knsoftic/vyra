import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Pressable, Badge, Chip, Button } from '../../components';
import { Slider } from '../../components/Controls';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { filters } from '../../mock';
import { useApiData } from '../../hooks/useApiData';
import { creative } from '../../api';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

type FilterGroup = 'all' | 'trending' | 'new' | 'premium';

export function FiltersScreen({ navigation }: RootScreenProps<'Filters'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();
  const [group, setGroup] = useState<FilterGroup>('all');
  const [intensity, setIntensity] = useState(80);

  // The catalogue is server-driven, which is what makes "an admin adds a filter
  // and it appears without an app release" true rather than aspirational.
  const { data: catalogue, source } = useApiData(
    () => creative.catalogue(),
    null,
    [],
    { requiresAuth: false },
  );

  const ordered = useMemo(() => {
    if (source === 'live' && catalogue) {
      return catalogue.filters
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((f) => ({
          id: f.slug,
          name: f.name,
          previewColor: f.previewColor,
          intensity: f.defaultIntensity,
          order: f.sortOrder,
          isPremium: f.isPremium,
          isTrending: f.isTrending,
          isNew: f.isNew,
        }));
    }
    return [...filters].sort((a, b) => a.order - b.order);
  }, [source, catalogue]);
  const visible = ordered.filter((filter) => {
    if (group === 'trending') return filter.isTrending;
    if (group === 'new') return filter.isNew;
    if (group === 'premium') return filter.isPremium;
    return true;
  });

  const selected = ordered.find((f) => f.id === compose.filterId) ?? ordered[0];

  return (
    <Screen dark background="#0A0A0B">
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Text variant="bodyStrong" tone="onDark">
          Filters
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="checkmark" size={26} color={theme.colors.brand} />
        </Pressable>
      </View>

      <View style={styles.previewWrap}>
        <EditorPreview showFilterName />
      </View>

      {/* Intensity — only meaningful once a filter is chosen */}
      {selected.id !== 'f_original' ? (
        <View style={[styles.intensityRow, { paddingHorizontal: theme.spacing.lg }]}>
          <Text variant="caption" tone="onDark">
            Intensity
          </Text>
          <View style={styles.flex}>
            <Slider value={intensity} onChange={setIntensity} min={0} max={100} />
          </View>
          <Text variant="caption" tone="onDark" style={styles.intensityValue}>
            {intensity}
          </Text>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.groups, { paddingHorizontal: theme.spacing.md }]}
      >
        {(
          [
            { id: 'all', label: 'All' },
            { id: 'trending', label: 'Trending' },
            { id: 'new', label: 'New' },
            { id: 'premium', label: 'Premium' },
          ] as const
        ).map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            size="sm"
            tone="brand"
            selected={group === item.id}
            onPress={() => setGroup(item.id)}
          />
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.carousel, { paddingHorizontal: theme.spacing.md }]}
      >
        {visible.map((filter) => {
          const active = filter.id === compose.filterId;
          return (
            <Pressable
              key={filter.id}
              onPress={() => setCompose({ filterId: filter.id })}
              style={styles.filterItem}
              haptic
            >
              <View
                style={[
                  styles.thumb,
                  {
                    borderColor: active ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Image
                  source={{ uri: compose.clips[0]?.thumb ?? 'https://picsum.photos/seed/preview/540/960' }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
                {filter.previewColor !== 'transparent' ? (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: filter.previewColor, opacity: filter.intensity / 100 },
                    ]}
                  />
                ) : null}

                {filter.isPremium ? (
                  <View style={styles.cornerTag}>
                    <Ionicons name="lock-closed" size={10} color="#FFF" />
                  </View>
                ) : null}
              </View>

              <Text variant="caption" tone="onDark" numberOfLines={1} align="center">
                {filter.name}
              </Text>

              {filter.isTrending ? <Badge label="Hot" tone="brand" size="sm" /> : null}
              {filter.isNew && !filter.isTrending ? <Badge label="New" tone="accent" size="sm" /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: theme.spacing.md }]}>
        <Button
          label="Manual adjustments"
          variant="outline"
          icon="options-outline"
          fullWidth
          onPress={() => navigation.navigate('Adjust')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewWrap: { flex: 1, margin: 16, marginTop: 4 },
  intensityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 },
  intensityValue: { width: 28, textAlign: 'right' },
  groups: { gap: 8, paddingBottom: 10 },
  carousel: { gap: 10, paddingBottom: 8 },
  filterItem: { width: 66, alignItems: 'center', gap: 5 },
  thumb: { width: 62, height: 82, borderWidth: 2, overflow: 'hidden' },
  cornerTag: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    padding: 3,
  },
  footer: { paddingVertical: 12 },
});
