import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Pressable, Button, Segmented, IconButton } from '../../components';
import { useTheme } from '../../theme';
import { useContentWidth } from '../../hooks/useResponsive';
import { galleryItems, appInfo } from '../../mock';
import { formatDuration } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

const GAP = 2;

export function UploadScreen({ navigation }: RootScreenProps<'Upload'>) {
  const theme = useTheme();
  const TILE = (useContentWidth() - GAP * 3) / 4;
  const { setCompose } = useApp();
  const [source, setSource] = useState<'gallery' | 'files'>('gallery');
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const proceed = () => {
    const chosen = galleryItems.filter((item) => selected.includes(item.id));
    setCompose({
      clips: chosen.map((item) => ({
        id: item.id,
        thumb: item.thumb,
        durationSec: item.durationSec,
        speed: 1,
      })),
    });
    navigation.navigate('Editor');
  };

  return (
    <Screen>
      <Header
        title="Select videos"
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="close" size={26} color={theme.colors.text} />
          </Pressable>
        }
        showBack={false}
        right={
          <IconButton icon="document-outline" size={20} onPress={() => navigation.navigate('Drafts')} />
        }
      />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'gallery', label: 'Gallery' },
            { id: 'files', label: 'Device files' },
          ]}
          value={source}
          onChange={setSource}
        />
      </View>

      <FlatList
        data={galleryItems}
        keyExtractor={(item) => item.id}
        numColumns={4}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const index = selected.indexOf(item.id);
          const isSelected = index >= 0;
          return (
            <Pressable onPress={() => toggle(item.id)} style={{ width: TILE, height: TILE * 1.3 }}>
              <Image source={{ uri: item.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={styles.durationTag}>
                <Text variant="caption" tone="onDark">
                  {formatDuration(item.durationSec)}
                </Text>
              </View>
              <View
                style={[
                  styles.check,
                  {
                    backgroundColor: isSelected ? theme.colors.brand : 'rgba(0,0,0,0.35)',
                    borderColor: isSelected ? theme.colors.brand : 'rgba(255,255,255,0.8)',
                  },
                ]}
              >
                {isSelected ? (
                  <Text variant="caption" tone="onDark">
                    {index + 1}
                  </Text>
                ) : null}
              </View>
              {isSelected ? (
                <View style={[styles.selectedOverlay, { borderColor: theme.colors.brand }]} />
              ) : null}
            </Pressable>
          );
        }}
      />

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
        <View style={styles.footerInfo}>
          <Text variant="label" tone="secondary">
            {selected.length} selected
          </Text>
          <Text variant="caption" tone="muted">
            Max {Math.round(appInfo.maxVideoDurationSec / 60)} min · {appInfo.maxFileSizeMb} MB ·{' '}
            {appInfo.supportedFormats.join(', ')}
          </Text>
        </View>
        <Button
          label="Next"
          variant="gradient"
          disabled={selected.length === 0}
          onPress={proceed}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  durationTag: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  check: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footerInfo: { flex: 1 },
});
