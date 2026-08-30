import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Pressable, Button, Chip, Segmented } from '../../components';
import { Slider } from '../../components/Controls';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { textFonts, textAnimations, textColors } from '../../mock';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

type Panel = 'style' | 'animation' | 'timing';
type Align = 'left' | 'center' | 'right';

export function TextOnVideoScreen({ navigation }: RootScreenProps<'TextOnVideo'>) {
  const theme = useTheme();
  const { compose, setCompose } = useApp();

  const [value, setValue] = useState('');
  const [font, setFont] = useState(textFonts[0].id);
  const [color, setColor] = useState(textColors[0]);
  const [size, setSize] = useState(28);
  const [align, setAlign] = useState<Align>('center');
  const [hasBackground, setHasBackground] = useState(false);
  const [animation, setAnimation] = useState(textAnimations[0].id);
  const [startAt, setStartAt] = useState(0);
  const [duration, setDuration] = useState(3);
  const [panel, setPanel] = useState<Panel>('style');

  const addOverlay = () => {
    if (!value.trim()) return navigation.goBack();
    setCompose({
      textOverlays: [
        ...compose.textOverlays,
        { id: `text_${Date.now()}`, text: value.trim(), color, font },
      ],
    });
    navigation.goBack();
  };

  return (
    <Screen dark background="#0A0A0B">
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Text variant="bodyStrong" tone="onDark">
          Text
        </Text>
        <Pressable onPress={addOverlay} hitSlop={theme.layout.hitSlop}>
          <Text variant="labelStrong" tone="brand">
            Done
          </Text>
        </Pressable>
      </View>

      <View style={styles.previewWrap}>
        <EditorPreview>
          {value ? (
            <View
              style={[
                styles.livePreview,
                {
                  alignItems:
                    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                },
              ]}
              pointerEvents="none"
            >
              <Text
                style={[
                  {
                    color,
                    fontSize: size,
                    fontWeight: font === 'bold' ? '800' : '600',
                    textAlign: align,
                    fontStyle: font === 'handwriting' ? 'italic' : 'normal',
                  },
                  hasBackground && {
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                    overflow: 'hidden',
                  },
                ]}
              >
                {value}
              </Text>
            </View>
          ) : (
            <View style={styles.hintWrap} pointerEvents="none">
              <Text variant="label" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Type below, then drag on the video to position
              </Text>
            </View>
          )}
        </EditorPreview>
      </View>

      {/* Input */}
      <View style={[styles.inputRow, { paddingHorizontal: theme.spacing.md }]}>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="Enter text"
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoFocus
          multiline
          style={[
            theme.typography.body,
            styles.input,
            { color: '#FFF', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: theme.radius.md },
          ]}
        />
      </View>

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'style', label: 'Style' },
            { id: 'animation', label: 'Animation' },
            { id: 'timing', label: 'Timing' },
          ]}
          value={panel}
          onChange={setPanel}
        />
      </View>

      <ScrollView style={styles.panel} showsVerticalScrollIndicator={false}>
        {panel === 'style' ? (
          <View style={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.md }}>
            <View>
              <Text variant="caption" tone="onDark">
                Font
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {textFonts.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.label}
                    size="sm"
                    tone="brand"
                    selected={font === item.id}
                    onPress={() => setFont(item.id)}
                  />
                ))}
              </ScrollView>
            </View>

            <View>
              <Text variant="caption" tone="onDark">
                Colour
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {textColors.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => setColor(item)}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: item,
                        borderColor: color === item ? theme.colors.brand : 'rgba(255,255,255,0.35)',
                      },
                    ]}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.alignRow}>
              <Text variant="caption" tone="onDark" style={styles.flex}>
                Alignment
              </Text>
              {(['left', 'center', 'right'] as Align[]).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setAlign(option)}
                  style={[
                    styles.alignButton,
                    { backgroundColor: align === option ? theme.colors.brand : 'rgba(255,255,255,0.1)' },
                  ]}
                >
                  <Ionicons name={`text-outline`} size={16} color="#FFF" />
                  <Text variant="caption" tone="onDark">
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.alignRow}>
              <Text variant="caption" tone="onDark" style={styles.flex}>
                Background
              </Text>
              <Pressable
                onPress={() => setHasBackground((b) => !b)}
                style={[
                  styles.alignButton,
                  { backgroundColor: hasBackground ? theme.colors.brand : 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Ionicons name={hasBackground ? 'checkbox-outline' : 'square-outline'} size={16} color="#FFF" />
                <Text variant="caption" tone="onDark">
                  {hasBackground ? 'On' : 'Off'}
                </Text>
              </Pressable>
            </View>

            <View>
              <View style={styles.sliderHeader}>
                <Text variant="caption" tone="onDark">
                  Size
                </Text>
                <Text variant="caption" tone="onDark">
                  {size}
                </Text>
              </View>
              <Slider value={size} min={12} max={64} onChange={setSize} />
            </View>
          </View>
        ) : panel === 'animation' ? (
          <View style={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.xs }}>
            {textAnimations.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setAnimation(item.id)}
                style={[
                  styles.animationRow,
                  {
                    backgroundColor:
                      animation === item.id ? theme.colors.brandSoft : 'rgba(255,255,255,0.06)',
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Text variant="body" tone="onDark" style={styles.flex}>
                  {item.label}
                </Text>
                {animation === item.id ? (
                  <Ionicons name="checkmark" size={18} color={theme.colors.brand} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.lg }}>
            <View>
              <View style={styles.sliderHeader}>
                <Text variant="caption" tone="onDark">
                  Appears at
                </Text>
                <Text variant="caption" tone="onDark">
                  {startAt.toFixed(1)}s
                </Text>
              </View>
              <Slider value={startAt} min={0} max={30} onChange={setStartAt} />
            </View>
            <View>
              <View style={styles.sliderHeader}>
                <Text variant="caption" tone="onDark">
                  Duration
                </Text>
                <Text variant="caption" tone="onDark">
                  {duration.toFixed(1)}s
                </Text>
              </View>
              <Slider value={duration} min={1} max={20} onChange={setDuration} />
            </View>
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Drag the text on the preview to reposition it. Pinch to resize, twist to rotate.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: theme.spacing.md }]}>
        <Button label="Add text" variant="gradient" fullWidth onPress={addOverlay} disabled={!value.trim()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewWrap: { height: 200, margin: 16, marginTop: 4 },
  livePreview: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 16 },
  hintWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  inputRow: { paddingBottom: 12 },
  input: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12 },
  panel: { flex: 1 },
  row: { gap: 8, paddingTop: 8 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  alignRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  animationRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  footer: { paddingVertical: 12 },
});
