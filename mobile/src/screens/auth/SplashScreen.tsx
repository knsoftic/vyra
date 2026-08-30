import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../components';
import { useTheme } from '../../theme';
import { useSession } from '../../store/SessionState';
import { appInfo } from '../../mock';
import type { RootScreenProps } from '../../navigation/types';

export function SplashScreen({ navigation }: RootScreenProps<'Splash'>) {
  const theme = useTheme();
  const { restoring, isSignedIn } = useSession();
  const scale = useRef(new Animated.Value(0.82)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  /**
   * Where to go once the stored session has been read.
   *
   * This used to be an unconditional `replace('Onboarding')` on a 1.5 second
   * timer, which sent a signed-in user to the welcome screen whenever reading
   * their session took longer than the animation — a cold start on mobile data
   * routinely does. Waiting for the answer costs a moment; guessing costs
   * someone their session.
   */
  useEffect(() => {
    if (restoring) return;

    // The animation still gets its moment, so the app does not blink.
    const timer = setTimeout(
      () => navigation.replace(isSignedIn ? 'MainTabs' : 'Onboarding'),
      900,
    );
    return () => clearTimeout(timer);
  }, [navigation, restoring, isSignedIn]);

  return (
    <View style={[styles.root, { backgroundColor: '#0A0A0B' }]}>
      <Animated.View style={{ transform: [{ scale }], opacity, alignItems: 'center' }}>
        <LinearGradient
          colors={[...theme.gradients.brandAccent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logo}
        >
          <Text variant="display" tone="onDark" style={styles.logoGlyph}>
            V
          </Text>
        </LinearGradient>

        <Text variant="h1" tone="onDark" style={{ marginTop: theme.spacing.lg }}>
          {appInfo.appName}
        </Text>
        <Text variant="label" style={{ color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
          Short videos. Real audiences.
        </Text>
      </Animated.View>

      <Animated.View style={[styles.footer, { opacity }]}>
        <Text variant="caption" style={{ color: 'rgba(255,255,255,0.35)' }}>
          v{appInfo.version}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyph: { fontSize: 36, fontWeight: '800' },
  footer: { position: 'absolute', bottom: 48 },
});
