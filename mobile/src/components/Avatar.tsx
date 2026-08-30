import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Text } from './Text';
import { VerificationTier } from '../types';

interface AvatarProps {
  uri?: string;
  size?: number;
  /** Draws the animated-looking gradient ring used for live creators. */
  live?: boolean;
  /** Draws a story-style ring without the LIVE pill. */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
  fallbackLabel?: string;
}

export function Avatar({ uri, size = 44, live = false, ring = false, style, fallbackLabel }: AvatarProps) {
  const theme = useTheme();
  const showRing = live || ring;
  const ringWidth = size >= 64 ? 3 : 2;
  const outer = size + (showRing ? ringWidth * 2 + 4 : 0);

  const image = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.surfaceAlt,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <Text variant="labelStrong" tone="secondary">
          {(fallbackLabel ?? '?').slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );

  if (!showRing) return <View style={style}>{image}</View>;

  return (
    <View style={[{ width: outer, height: outer }, styles.center, style]}>
      <LinearGradient
        colors={live ? [...theme.gradients.live] : [...theme.gradients.brandAccent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: outer / 2 },
        ]}
      />
      <View
        style={{
          width: size + 4,
          height: size + 4,
          borderRadius: (size + 4) / 2,
          backgroundColor: theme.colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {image}
      </View>

      {live ? (
        <View
          style={[
            styles.livePill,
            { backgroundColor: theme.colors.brand, bottom: -6 },
          ]}
        >
          <Text variant="caption" style={styles.liveText}>
            LIVE
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Verification tick. Colour differs by tier so business badges are distinguishable. */
export function VerifiedBadge({
  tier,
  size = 14,
}: {
  tier: VerificationTier | undefined;
  size?: number;
}) {
  const theme = useTheme();

  /**
   * A tick is drawn only for a tier that actually means verified.
   *
   * This used to be `if (tier === 'none') return null`, which drew a blue tick
   * for `undefined` as well — so any caller with an incomplete user object
   * showed a verification nobody earned. The type said the prop was required,
   * but a cast or an optional field defeats that, and a fabricated trust signal
   * is not something to leave resting on the type checker.
   */
  if (tier !== 'individual' && tier !== 'creator' && tier !== 'business') return null;

  const color =
    tier === 'business' ? theme.colors.gold : tier === 'creator' ? theme.colors.accent : theme.colors.info;

  return <Ionicons name="checkmark-circle" size={size} color={color} />;
}

/** Name + verification tick, used everywhere a username appears. */
export function NameWithBadge({
  name,
  tier,
  variant = 'bodyStrong',
  tone = 'primary',
  size = 14,
  numberOfLines = 1,
}: {
  name: string;
  tier: VerificationTier | undefined;
  variant?: React.ComponentProps<typeof Text>['variant'];
  tone?: React.ComponentProps<typeof Text>['tone'];
  size?: number;
  numberOfLines?: number;
}) {
  return (
    <View style={styles.nameRow}>
      <Text variant={variant} tone={tone} numberOfLines={numberOfLines} style={styles.shrink}>
        {name}
      </Text>
      <VerifiedBadge tier={tier} size={size} />
    </View>
  );
}

/** Overlapping avatar stack for group chats and call participants. */
export function AvatarGroup({
  uris,
  size = 32,
  max = 3,
}: {
  uris: string[];
  size?: number;
  max?: number;
}) {
  const theme = useTheme();
  const shown = uris.slice(0, max);
  const extra = uris.length - shown.length;

  return (
    <View style={styles.row}>
      {shown.map((uri, index) => (
        <View key={`${uri}-${index}`} style={{ marginLeft: index === 0 ? 0 : -size / 3 }}>
          <View
            style={{
              borderWidth: 2,
              borderColor: theme.colors.bg,
              borderRadius: (size + 4) / 2,
            }}
          >
            <Avatar uri={uri} size={size} />
          </View>
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={{
            marginLeft: -size / 3,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.colors.surfaceAlt,
            borderWidth: 2,
            borderColor: theme.colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" tone="secondary">
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  livePill: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  liveText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
