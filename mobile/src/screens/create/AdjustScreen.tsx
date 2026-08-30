import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Pressable, Button, Badge } from '../../components';
import { SliderRow } from '../../components/Controls';
import { EditorPreview } from '../../components/create/EditorPreview';
import { useTheme } from '../../theme';
import { adjustmentControls, filters } from '../../mock';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

export function AdjustScreen({ navigation }: RootScreenProps<'Adjust'>) {
  const theme = useTheme();
  const { compose, setAdjustment, resetAdjustments } = useApp();
  const [comparing, setComparing] = useState(false);

  const changedCount = adjustmentControls.filter(
    (control) => compose.adjustments[control.id] !== control.defaultValue,
  ).length;

  return (
    <Screen dark background="#0A0A0B">
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" tone="onDark">
            Adjust
          </Text>
          {changedCount > 0 ? <Badge label={`${changedCount}`} tone="brand" size="sm" /> : null}
        </View>
        <Pressable onPress={() => navigation.goBack()} hitSlop={theme.layout.hitSlop}>
          <Ionicons name="checkmark" size={26} color={theme.colors.brand} />
        </Pressable>
      </View>

      <View style={styles.previewWrap}>
        {/* Holding "Compare" shows the untouched original. */}
        <EditorPreview overrideFilterId={comparing ? filters[0].id : undefined}>
          {comparing ? (
            <View style={styles.compareTag}>
              <Text variant="caption" tone="onDark">
                ORIGINAL
              </Text>
            </View>
          ) : null}
        </EditorPreview>

        <Pressable
          onPressIn={() => setComparing(true)}
          onPressOut={() => setComparing(false)}
          style={[styles.compareButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
        >
          <Ionicons name="eye-outline" size={16} color="#FFF" />
          <Text variant="caption" tone="onDark">
            Hold to compare
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.controls}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {adjustmentControls.map((control) => (
          <SliderRow
            key={control.id}
            label={control.label}
            value={compose.adjustments[control.id] ?? control.defaultValue}
            min={control.min}
            max={control.max}
            defaultValue={control.defaultValue}
            onChange={(value) => setAdjustment(control.id, value)}
          />
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: theme.spacing.md }]}>
        <Button
          label="Reset all"
          variant="outline"
          icon="refresh"
          onPress={resetAdjustments}
          disabled={changedCount === 0}
          style={styles.flex}
        />
        <Button
          label="Apply"
          variant="gradient"
          onPress={() => navigation.goBack()}
          style={styles.flex}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewWrap: { height: 230, margin: 16, marginTop: 4 },
  compareButton: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  compareTag: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  controls: { flex: 1 },
  footer: { flexDirection: 'row', gap: 10, paddingVertical: 12 },
});
