import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleProp, TextStyle } from 'react-native';
import { useTheme } from '../theme';

type Variant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'labelStrong'
  | 'caption';

type Tone = 'primary' | 'secondary' | 'muted' | 'brand' | 'accent' | 'success' | 'danger' | 'warning' | 'inverse' | 'onDark';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/**
 * The only text component in the app. Screens never set fontSize or colour
 * directly — they pick a variant and a tone.
 */
export function Text({
  variant = 'body',
  tone = 'primary',
  align,
  style,
  children,
  ...rest
}: TextProps) {
  const theme = useTheme();

  const toneColor: Record<Tone, string> = {
    primary: theme.colors.text,
    secondary: theme.colors.textSecondary,
    muted: theme.colors.textMuted,
    brand: theme.colors.brand,
    accent: theme.colors.accent,
    success: theme.colors.success,
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    inverse: theme.colors.textInverse,
    onDark: '#FFFFFF',
  };

  return (
    <RNText
      {...rest}
      style={[
        theme.typography[variant] as TextStyle,
        { color: toneColor[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
