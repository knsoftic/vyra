import React from 'react';
import { View, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Pressable } from './Pressable';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gradient';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const theme = useTheme();

  const height = size === 'sm' ? 36 : size === 'lg' ? 52 : 44;
  const paddingHorizontal = size === 'sm' ? theme.spacing.sm : theme.spacing.lg;
  const textVariant = size === 'sm' ? 'labelStrong' : 'bodyStrong';
  const iconSize = size === 'sm' ? 16 : 18;

  const surface: Record<Variant, { bg: string; border?: string; fg: string }> = {
    primary: { bg: theme.colors.brand, fg: '#FFFFFF' },
    secondary: { bg: theme.colors.surfaceAlt, fg: theme.colors.text },
    outline: { bg: 'transparent', border: theme.colors.borderStrong, fg: theme.colors.text },
    ghost: { bg: 'transparent', fg: theme.colors.text },
    danger: { bg: theme.colors.danger, fg: '#FFFFFF' },
    gradient: { bg: 'transparent', fg: '#FFFFFF' },
  };

  const s = surface[variant];

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={s.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={iconSize} color={s.fg} /> : null}
          <Text variant={textVariant} style={{ color: s.fg }} numberOfLines={1}>
            {label}
          </Text>
          {iconRight ? <Ionicons name={iconRight} size={iconSize} color={s.fg} /> : null}
        </>
      )}
    </>
  );

  const innerStyle: ViewStyle = {
    height,
    paddingHorizontal,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  };

  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      haptic
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      style={[
        fullWidth ? styles.fullWidth : undefined,
        disabled ? styles.disabled : undefined,
        style,
      ]}
    >
      {variant === 'gradient' ? (
        <LinearGradient
          colors={[...theme.gradients.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={innerStyle}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={[
            innerStyle,
            {
              backgroundColor: s.bg,
              borderWidth: s.border ? 1 : 0,
              borderColor: s.border,
            },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
  color?: string;
  background?: string;
  circle?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  onPress,
  size = 22,
  color,
  background,
  circle = false,
  label,
  style,
}: IconButtonProps) {
  const theme = useTheme();
  const dimension = size + theme.spacing.md;

  return (
    <Pressable
      onPress={onPress}
      haptic
      hitSlop={theme.layout.hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      style={[
        circle
          ? {
              width: dimension,
              height: dimension,
              borderRadius: dimension / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: background ?? theme.colors.surfaceAlt,
            }
          : undefined,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color ?? theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.45 },
});
