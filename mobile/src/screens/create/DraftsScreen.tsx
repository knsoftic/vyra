import React, { useState, useMemo } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Pressable, Button, EmptyState, Badge } from '../../components';
import { useTheme } from '../../theme';
import { useContentWidth } from '../../hooks/useResponsive';
import { drafts as mockDrafts } from '../../mock';
import { useApiData } from '../../hooks/useApiData';
import { creative } from '../../api';
import { formatDuration, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const GAP = 8;

export function DraftsScreen({ navigation }: RootScreenProps<'Drafts'>) {
  const theme = useTheme();
  const TILE = (useContentWidth() - 16 * 2 - GAP * 2) / 3;
  // Drafts live on the server precisely so they survive a reinstall, so this
  // screen reads them from there rather than from local state.
  const { data: serverDrafts, source, refresh } = useApiData(
    () => creative.drafts(),
    [],
    [],
  );

  const drafts = useMemo(
    () =>
      source === 'live'
        ? serverDrafts.map((d) => ({
            id: d.id,
            poster: d.coverUrl ?? `https://picsum.photos/seed/${d.id}/300/540`,
            caption: d.caption,
            durationSec: d.durationSec,
            clipCount: d.clipCount,
            updatedAt: d.updatedAt,
          }))
        : mockDrafts,
    [source, serverDrafts],
  );

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const deleteSelected = async () => {
    if (source === 'live') {
      // Soft-deleted on the server, so an accidental removal is recoverable.
      await Promise.all(selected.map((id) => creative.deleteDraft(id).catch(() => undefined)));
      await refresh();
    }
    setSelected([]);
    setSelecting(false);
  };

  return (
    <Screen>
      <Header
        title="Drafts"
        subtitle={`${drafts.length} saved`}
        right={
          drafts.length > 0 ? (
            <Pressable
              onPress={() => {
                setSelecting((s) => !s);
                setSelected([]);
              }}
              hitSlop={theme.layout.hitSlop}
            >
              <Text variant="label" tone="brand">
                {selecting ? 'Cancel' : 'Select'}
              </Text>
            </Pressable>
          ) : null
        }
      />

      <FlatList
        data={drafts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, padding: theme.spacing.md, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View
            style={[
              styles.notice,
              { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.sm },
            ]}
          >
            <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.success} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Drafts are private and are kept through app updates. They are never cleared
              automatically.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="document-outline"
            title="No drafts"
            description="Videos you save while editing appear here, and stay until you publish or delete them."
            actionLabel="Create a video"
            onAction={() => navigation.navigate('Record')}
          />
        }
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.id);
          return (
            <Pressable
              onPress={() => (selecting ? toggle(item.id) : navigation.navigate('Editor'))}
              onLongPress={() => {
                setSelecting(true);
                toggle(item.id);
              }}
              style={{ width: TILE, height: TILE * 1.6 }}
            >
              <Image
                source={{ uri: item.poster }}
                style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.sm }]}
                contentFit="cover"
              />
              <LinearGradient
                colors={[...theme.gradients.dark]}
                style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.sm }]}
              />

              <View style={styles.topRow}>
                <Badge label={`${item.clipCount} clips`} tone="neutral" size="sm" />
              </View>

              <View style={styles.bottomRow}>
                <Text variant="caption" tone="onDark" numberOfLines={2}>
                  {item.caption || 'Untitled draft'}
                </Text>
                <View style={styles.metaRow}>
                  <Text variant="caption" tone="onDark">
                    {formatDuration(item.durationSec)}
                  </Text>
                  <Text variant="caption" tone="onDark">
                    {timeAgo(item.updatedAt)}
                  </Text>
                </View>
              </View>

              {selecting ? (
                <View
                  style={[
                    styles.check,
                    {
                      backgroundColor: isSelected ? theme.colors.brand : 'rgba(0,0,0,0.4)',
                      borderColor: isSelected ? theme.colors.brand : 'rgba(255,255,255,0.8)',
                    },
                  ]}
                >
                  {isSelected ? <Ionicons name="checkmark" size={13} color="#FFF" /> : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      {selecting && selected.length > 0 ? (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.colors.bg,
              borderTopColor: theme.colors.border,
              padding: theme.spacing.md,
            },
          ]}
        >
          <Text variant="label" tone="secondary" style={styles.flex}>
            {selected.length} selected
          </Text>
          <Button label="Delete" variant="danger" icon="trash-outline" onPress={() => void deleteSelected()} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  topRow: { position: 'absolute', top: 6, left: 6 },
  bottomRow: { position: 'absolute', left: 6, right: 6, bottom: 6, gap: 3 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
