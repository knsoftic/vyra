import React, { useCallback } from 'react';
import {
  Pressable as RNPressable,
  PressableProps as RNPressableProps,
  StyleProp,
  ViewStyle,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export interface PressableProps extends Omit<RNPressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Opacity applied while pressed. Set to 1 to disable the effect. */
  activeOpacity?: number;
  /** Light haptic tap on press — used for primary actions and feed controls. */
  haptic?: boolean;
  children?: React.ReactNode;
}

/**
 * Pressable with a consistent press response across the app.
 * Haptics are skipped on web, where the API is unavailable.
 */
export function Pressable({
  style,
  activeOpacity = 0.6,
  haptic = false,
  onPress,
  children,
  ...rest
}: PressableProps) {
  const handlePress = useCallback<NonNullable<RNPressableProps['onPress']>>(
    (event) => {
      if (haptic && Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      onPress?.(event);
    },
    [haptic, onPress],
  );

  return (
    <RNPressable
      {...rest}
      onPress={handlePress}
      style={({ pressed }) => [style, pressed && { opacity: activeOpacity }]}
    >
      {children}
    </RNPressable>
  );
}
