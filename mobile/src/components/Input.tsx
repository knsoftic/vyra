import React, { useState } from 'react';
import {
  View,
  TextInput,
  TextInputProps,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Pressable } from './Pressable';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  multiline?: boolean;
  /** Character counter shown when `maxLength` is set. */
  showCounter?: boolean;
}

export function Input({
  label,
  hint,
  error,
  icon,
  rightIcon,
  onRightIconPress,
  containerStyle,
  multiline,
  showCounter,
  maxLength,
  value,
  secureTextEntry,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.brand
      : theme.colors.border;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.surface,
            borderColor,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            minHeight: multiline ? 96 : 48,
            alignItems: multiline ? 'flex-start' : 'center',
            paddingVertical: multiline ? theme.spacing.sm : 0,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={focused ? theme.colors.brand : theme.colors.textMuted}
            style={{ marginRight: theme.spacing.xs }}
          />
        ) : null}

        <TextInput
          {...rest}
          value={value}
          maxLength={maxLength}
          multiline={multiline}
          secureTextEntry={hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            theme.typography.body,
            {
              color: theme.colors.text,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
        />

        {secureTextEntry ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={theme.layout.hitSlop}>
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={18}
              color={theme.colors.textMuted}
            />
          </Pressable>
        ) : rightIcon ? (
          <Pressable onPress={onRightIconPress} hitSlop={theme.layout.hitSlop}>
            <Ionicons name={rightIcon} size={18} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.footerRow}>
        <View style={styles.flex}>
          {error ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.xxs }}>
              {error}
            </Text>
          ) : hint ? (
            <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
              {hint}
            </Text>
          ) : null}
        </View>
        {showCounter && maxLength ? (
          <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
            {(value?.length ?? 0)}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Six-box OTP entry backed by a single hidden input. */
export function OtpInput({
  length = 6,
  value,
  onChange,
}: {
  length?: number;
  value: string;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();
  const inputRef = React.useRef<TextInput>(null);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} activeOpacity={1}>
      <View style={styles.otpRow}>
        {Array.from({ length }).map((_, index) => {
          const char = value[index] ?? '';
          const active = index === value.length;
          return (
            <View
              key={index}
              style={[
                styles.otpBox,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: active ? theme.colors.brand : theme.colors.border,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text variant="h2">{char}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        style={styles.hiddenInput}
        autoFocus
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    borderWidth: 1,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  otpRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  otpBox: {
    width: 48,
    height: 56,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
});
