import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Pressable, Button, Sheet, ListRow, Badge, EmptyState } from '../../components';
import { SliderRow } from '../../components/Controls';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { speedOptions } from '../../mock';
import { useApp, type ComposeClip } from '../../store/AppState';
import { formatDuration } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

/*
 * `crop` is deliberately absent.
 *
 * The edit list can express a crop rectangle and the renderer applies one, but
 * there is no way to choose that rectangle here yet — and a Crop button that
 * silently does nothing is worse than no Crop button. It comes back with the
 * frame picker that lets someone actually draw it.
 */
type ClipTool = 'trim' | 'split' | 'delete' | 'speed' | 'rotate' | 'duplicate';

export function EditorScreen({ navigation }: RootScreenProps<'Editor'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  /*
   * The footage being edited, and only real footage.
   *
   * This fell back to `editorClips` — the bundled samples — whenever compose
   * was empty, so the editor would happily let someone trim, split and publish
   * clips that do not exist and whose storage keys the server has never seen.
   * Anyone here arrived from Record or Upload, so an empty timeline means
   * something went wrong, and saying so is more use than pretending.
   */
  const clips: ComposeClip[] = compose.clips;
  const [selectedClip, setSelectedClip] = useState(clips[0]?.id);
  const [speedSheet, setSpeedSheet] = useState(false);
  const [trimSheet, setTrimSheet] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  /** What the finished video will actually run to, trims and speeds included. */
  const usedSeconds = (clip: (typeof clips)[number]) => {
    const fullMs = Math.round(clip.durationSec * 1000);
    const startMs = clip.trimStartMs ?? 0;
    const endMs = clip.trimEndMs ?? fullMs;
    return Math.max(0, endMs - startMs) / 1000 / (clip.speed || 1);
  };

  const totalDuration = clips.reduce((sum, clip) => sum + usedSeconds(clip), 0);
  const active = clips.find((clip) => clip.id === selectedClip) ?? clips[0];

  const pushHistory = (action: string) => setHistory((prev) => [...prev, action]);

  /** Replaces the selected clip, keeping the rest of the timeline in order. */
  const replaceActive = (patch: Partial<(typeof clips)[number]>) => {
    if (!active) return;
    setCompose({
      clips: clips.map((clip) => (clip.id === active.id ? { ...clip, ...patch } : clip)),
    });
  };

  /*
   * Every branch here changes the clip. The default used to be
   * `pushHistory('Applied ' + tool)` — trim, split, rotate and crop each added
   * a line to the undo list claiming an edit that never happened, which is a
   * worse failure than a button doing nothing: the history said it worked.
   */
  const applyClipTool = (tool: ClipTool) => {
    if (!active) return;

    if (tool === 'delete') {
      const next = clips.filter((clip) => clip.id !== selectedClip);
      setCompose({ clips: next });
      setSelectedClip(next[0]?.id);
      pushHistory('Deleted clip');
      return;
    }

    if (tool === 'speed') return setSpeedSheet(true);
    if (tool === 'trim') return setTrimSheet(true);

    if (tool === 'rotate') {
      const next = (((active.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
      replaceActive({ rotation: next });
      pushHistory(`Rotated to ${next}°`);
      return;
    }

    if (tool === 'duplicate') {
      const copy = { ...active, id: `${active.id}_copy_${Date.now()}` };
      setCompose({ clips: [...clips, copy] });
      pushHistory('Duplicated clip');
      return;
    }

    if (tool === 'split') {
      /*
       * Two clips from one source, with adjacent trim ranges. Nothing is cut on
       * the device — the renderer reads both entries and lays them end to end,
       * which is also why the halves can be reordered or trimmed separately
       * afterwards.
       */
      const fullMs = Math.round(active.durationSec * 1000);
      const startMs = active.trimStartMs ?? 0;
      const endMs = active.trimEndMs ?? fullMs;
      if (endMs - startMs < 400) {
        pushHistory('Too short to split');
        return;
      }
      const midMs = startMs + Math.round((endMs - startMs) / 2);

      const first = { ...active, trimEndMs: midMs };
      const second = { ...active, id: `${active.id}_b_${Date.now()}`, trimStartMs: midMs };
      const index = clips.findIndex((clip) => clip.id === active.id);
      const next = [...clips];
      next.splice(index, 1, first, second);

      setCompose({ clips: next });
      pushHistory('Split clip');
      return;
    }
  };

  const moveClip = (direction: -1 | 1) => {
    const index = clips.findIndex((clip) => clip.id === selectedClip);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= clips.length) return;
    const next = [...clips];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setCompose({ clips: next });
    pushHistory('Reordered clips');
  };

  const clipTools: { id: ClipTool; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'trim', label: 'Trim', icon: 'cut-outline' },
    { id: 'split', label: 'Split', icon: 'git-branch-outline' },
    { id: 'speed', label: 'Speed', icon: 'speedometer-outline' },
    { id: 'rotate', label: 'Rotate', icon: 'refresh-outline' },
    { id: 'duplicate', label: 'Duplicate', icon: 'copy-outline' },
    { id: 'delete', label: 'Delete', icon: 'trash-outline' },
  ];

  const creativeTools: {
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    route: keyof import('../../navigation/types').RootStackParamList;
    badge?: string;
  }[] = [
    { id: 'filters', label: 'Filters', icon: 'color-filter-outline', route: 'Filters' },
    { id: 'adjust', label: 'Adjust', icon: 'options-outline', route: 'Adjust' },
    { id: 'effects', label: 'Effects', icon: 'color-wand-outline', route: 'Effects' },
    { id: 'text', label: 'Text', icon: 'text-outline', route: 'TextOnVideo' },
    { id: 'stickers', label: 'Stickers', icon: 'happy-outline', route: 'Stickers' },
    { id: 'music', label: 'Sound', icon: 'musical-notes-outline', route: 'Music' },
    { id: 'voice', label: 'Voiceover', icon: 'mic-outline', route: 'Voiceover' },
    { id: 'cover', label: 'Cover', icon: 'image-outline', route: 'CoverPicker' },
  ];

  // Nothing to edit. Reachable only if the footage was lost between screens.
  if (clips.length === 0) {
    return (
      <Screen dark background="#0A0A0B">
        <View style={styles.emptyRoot}>
          <EmptyState
            icon="film-outline"
            title="No footage to edit"
            description="Record something or pick a video from your gallery, and the editor will open with it."
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button label="Record" variant="primary" onPress={() => navigation.replace('Record')} />
            <Button label="Upload" variant="secondary" onPress={() => navigation.replace('Upload')} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen dark background="#0A0A0B">
      {/* Top bar */}
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="chevron-back" size={26} color="#FFF" />
        </Pressable>

        <View style={styles.topActions}>
          <Pressable
            onPress={() => {
              if (history.length === 0) return;
              setHistory((prev) => prev.slice(0, -1));
            }}
            hitSlop={theme.layout.hitSlop}
            style={history.length === 0 ? styles.disabled : undefined}
          >
            <Ionicons name="arrow-undo-outline" size={22} color="#FFF" />
          </Pressable>
          <Pressable hitSlop={theme.layout.hitSlop} style={styles.disabled}>
            <Ionicons name="arrow-redo-outline" size={22} color="#FFF" />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Drafts')} hitSlop={theme.layout.hitSlop}>
            <Text variant="label" tone="onDark">
              Drafts
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Preview */}
      <View style={styles.previewWrap}>
        <EditorPreview showFilterName>
          <View style={styles.playOverlay} pointerEvents="none">
            <Ionicons name="play-circle-outline" size={54} color="rgba(255,255,255,0.75)" />
          </View>
          <View style={styles.durationTag}>
            <Text variant="caption" tone="onDark">
              {formatDuration(totalDuration)}
            </Text>
          </View>
        </EditorPreview>
      </View>

      {/* Creative tool rail */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.toolRail, { paddingHorizontal: theme.spacing.md }]}
      >
        {creativeTools.map((tool) => (
          <Pressable
            key={tool.id}
            onPress={() => navigation.navigate(tool.route as never)}
            style={styles.tool}
            haptic
          >
            <View style={[styles.toolIcon, { backgroundColor: 'rgba(255,255,255,0.10)' }]}>
              <Ionicons name={tool.icon} size={21} color="#FFF" />
            </View>
            <Text variant="caption" tone="onDark">
              {tool.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Timeline */}
      <View style={[styles.timelineSection, { borderTopColor: 'rgba(255,255,255,0.08)' }]}>
        <View style={[styles.timelineHeader, { paddingHorizontal: theme.spacing.md }]}>
          <Text variant="label" tone="onDark">
            Timeline
          </Text>
          <View style={styles.reorderRow}>
            <Pressable onPress={() => moveClip(-1)} hitSlop={theme.layout.hitSlop}>
              <Ionicons name="chevron-back-circle-outline" size={20} color="#FFF" />
            </Pressable>
            <Pressable onPress={() => moveClip(1)} hitSlop={theme.layout.hitSlop}>
              <Ionicons name="chevron-forward-circle-outline" size={20} color="#FFF" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.timeline, { paddingHorizontal: theme.spacing.md }]}
        >
          {clips.map((clip, index) => {
            const selected = clip.id === selectedClip;
            return (
              <Pressable
                key={clip.id}
                onPress={() => setSelectedClip(clip.id)}
                style={[
                  styles.clip,
                  {
                    borderColor: selected ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.sm,
                    width: Math.max(44, Math.min(110, clip.durationSec * 8)),
                  },
                ]}
              >
                <Image source={{ uri: clip.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={styles.clipFooter}>
                  <Text variant="caption" tone="onDark">
                    {formatDuration(clip.durationSec / clip.speed)}
                  </Text>
                  {clip.speed !== 1 ? (
                    <Badge label={`${clip.speed}x`} tone="brand" size="sm" />
                  ) : null}
                </View>
                <View style={styles.clipIndex}>
                  <Text variant="caption" tone="onDark">
                    {index + 1}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => navigation.navigate('Record')}
            style={[styles.addClip, { borderColor: 'rgba(255,255,255,0.35)', borderRadius: theme.radius.sm }]}
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </Pressable>
        </ScrollView>

        {/* Clip tools */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.clipTools, { paddingHorizontal: theme.spacing.md }]}
        >
          {clipTools.map((tool) => (
            <Pressable
              key={tool.id}
              onPress={() => applyClipTool(tool.id)}
              style={styles.clipTool}
              haptic
            >
              <Ionicons
                name={tool.icon}
                size={18}
                color={tool.id === 'delete' ? theme.colors.danger : '#FFF'}
              />
              <Text
                variant="caption"
                style={{ color: tool.id === 'delete' ? theme.colors.danger : '#FFF' }}
              >
                {tool.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingHorizontal: theme.spacing.md }]}>
        <Button
          label="Save draft"
          variant="outline"
          onPress={() => navigation.navigate('Drafts')}
          style={styles.flex}
        />
        <Button
          label="Next"
          variant="gradient"
          iconRight="arrow-forward"
          onPress={() => navigation.navigate('CaptionEditor')}
          style={styles.flex}
        />
      </View>

      {/*
        Trim.

        Two positions inside the source, in milliseconds. Nothing is cut on the
        device — the numbers travel with the clip and the renderer applies them,
        which is what keeps the trim reversible right up until publish.
      */}
      <Sheet visible={trimSheet} onClose={() => setTrimSheet(false)} title="Trim clip" height={0.45}>
        {active ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              Keeping {formatDuration(usedSeconds(active))} of {formatDuration(active.durationSec)}
            </Text>

            <SliderRow
              label="Start"
              value={Math.round((active.trimStartMs ?? 0) / 100) / 10}
              min={0}
              max={Math.max(0.1, active.durationSec - 0.2)}
              defaultValue={0}
              onChange={(seconds) => {
                const startMs = Math.round(seconds * 1000);
                const endMs = active.trimEndMs ?? Math.round(active.durationSec * 1000);
                // The two handles cannot cross; 200ms is the shortest usable clip.
                replaceActive({ trimStartMs: Math.min(startMs, endMs - 200) });
              }}
            />

            <SliderRow
              label="End"
              value={Math.round((active.trimEndMs ?? Math.round(active.durationSec * 1000)) / 100) / 10}
              min={0.2}
              max={active.durationSec}
              defaultValue={active.durationSec}
              onChange={(seconds) => {
                const endMs = Math.round(seconds * 1000);
                const startMs = active.trimStartMs ?? 0;
                replaceActive({ trimEndMs: Math.max(endMs, startMs + 200) });
              }}
            />

            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
              <Button
                label="Reset"
                variant="secondary"
                onPress={() =>
                  replaceActive({
                    trimStartMs: 0,
                    trimEndMs: Math.round(active.durationSec * 1000),
                  })
                }
              />
              <Button
                label="Done"
                variant="primary"
                onPress={() => {
                  pushHistory('Trimmed clip');
                  setTrimSheet(false);
                }}
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={speedSheet} onClose={() => setSpeedSheet(false)} title="Clip speed" height={0.4}>
        {speedOptions.map((option) => (
          <ListRow
            key={option.id}
            label={option.label}
            showChevron={false}
            onPress={() => {
              setCompose({
                clips: clips.map((clip) =>
                  clip.id === selectedClip ? { ...clip, speed: option.value } : clip,
                ),
              });
              pushHistory('Changed speed');
              setSpeedSheet(false);
            }}
            right={
              active?.speed === option.value ? (
                <Ionicons name="checkmark" size={18} color={theme.colors.brand} />
              ) : null
            }
          />
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  flex: { flex: 1 },
  disabled: { opacity: 0.35 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  previewWrap: { flex: 1, margin: 16, marginTop: 4 },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  durationTag: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  toolRail: { gap: 18, paddingBottom: 12 },
  tool: { alignItems: 'center', gap: 5, width: 56 },
  toolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  timelineSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 10 },
  timelineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reorderRow: { flexDirection: 'row', gap: 12 },
  timeline: { gap: 6, alignItems: 'center' },
  clip: { height: 62, borderWidth: 2, overflow: 'hidden' },
  clipFooter: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    right: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clipIndex: {
    position: 'absolute',
    top: 3,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  addClip: {
    width: 44,
    height: 62,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipTools: { gap: 20, paddingBottom: 6 },
  clipTool: { alignItems: 'center', gap: 3, minWidth: 46 },
  footer: { flexDirection: 'row', gap: 10, paddingVertical: 12 },
});
