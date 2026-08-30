import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Pressable, Badge, Chip, Button } from '../../components';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { useContentWidth } from '../../hooks/useResponsive';
import { effects, effectCategories } from '../../mock';
import { useApiData } from '../../hooks/useApiData';
import { creative } from '../../api';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';


export function EffectsScreen({ navigation }: RootScreenProps<'Effects'>) {
  const theme = useTheme();
  const TILE = (useContentWidth() - 16 * 2 - 12 * 3) / 4;
  const { compose, toggleEffect, setCompose } = useApp();
  const [category, setCategory] = useState<string>('all');

  // Server-driven like the filter catalogue, so an admin can add or retire an
  // effect without an app release.
  const { data: catalogue, source } = useApiData(
    () => creative.catalogue(),
    null,
    [],
    { requiresAuth: false },
  );

  const available = useMemo(() => {
    if (source === 'live' && catalogue) {
      return catalogue.effects
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((e) => ({
          id: e.slug,
          name: e.name,
          category: e.category,
          icon: e.icon,
          isPremium: e.isPremium,
          isTrending: e.isTrending,
          isNew: e.isNew,
        }));
    }
    return effects;
  }, [source, catalogue]);

  const visible = available.filter((effect) => category === 'all' || effect.category === category);

  return (
    <Screen dark background="#0A0A0B">
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Text variant="bodyStrong" tone="onDark">
          Effects
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="checkmark" size={26} color={theme.colors.brand} />
        </Pressable>
      </View>

      <View style={styles.previewWrap}>
        <EditorPreview />
      </View>

      <View style={styles.selectionRow}>
        <Text variant="caption" tone="onDark" style={{ paddingHorizontal: theme.spacing.md }}>
          {compose.effectIds.length === 0
            ? 'Tap an effect to apply it. Effects stack in the order you add them.'
            : `${compose.effectIds.length} applied`}
        </Text>
        {compose.effectIds.length > 0 ? (
          <Pressable onPress={() => setCompose({ effectIds: [] })} style={{ paddingHorizontal: theme.spacing.md }}>
            <Text variant="caption" tone="brand">
              Clear all
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.categories, { paddingHorizontal: theme.spacing.md }]}
      >
        {effectCategories.map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            size="sm"
            tone="brand"
            selected={category === item.id}
            onPress={() => setCategory(item.id)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        numColumns={4}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, gap: 12 }}
        columnWrapperStyle={{ gap: 12 }}
        showsVerticalScrollIndicator={false}
        style={styles.grid}
        renderItem={({ item }) => {
          const active = compose.effectIds.includes(item.id);
          const order = compose.effectIds.indexOf(item.id) + 1;
          return (
            <Pressable onPress={() => toggleEffect(item.id)} style={{ width: TILE }} haptic>
              <View
                style={[
                  styles.effectTile,
                  {
                    backgroundColor: active ? theme.colors.brandSoft : 'rgba(255,255,255,0.08)',
                    borderColor: active ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.md,
                    height: TILE,
                  },
                ]}
              >
                <Ionicons
                  name={item.icon as never}
                  size={22}
                  color={active ? theme.colors.brand : '#FFF'}
                />
                {active ? (
                  <View style={[styles.orderDot, { backgroundColor: theme.colors.brand }]}>
                    <Text variant="caption" tone="onDark">
                      {order}
                    </Text>
                  </View>
                ) : null}
                {item.isPremium ? (
                  <View style={styles.lock}>
                    <Ionicons name="lock-closed" size={9} color="#FFF" />
                  </View>
                ) : null}
              </View>
              <Text variant="caption" tone="onDark" numberOfLines={1} align="center" style={{ marginTop: 4 }}>
                {item.name}
              </Text>
              {item.isTrending ? <Badge label="Hot" tone="brand" size="sm" style={styles.centerBadge} /> : null}
              {item.isNew && !item.isTrending ? (
                <Badge label="New" tone="accent" size="sm" style={styles.centerBadge} />
              ) : null}
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { paddingHorizontal: theme.spacing.md }]}>
        <Button label="Done" variant="gradient" fullWidth onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewWrap: { height: 220, margin: 16, marginTop: 4 },
  selectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  categories: { gap: 8, paddingBottom: 10 },
  grid: { flex: 1 },
  effectTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  orderDot: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: { position: 'absolute', bottom: 4, right: 4 },
  centerBadge: { alignSelf: 'center' },
  footer: { paddingVertical: 12 },
});
