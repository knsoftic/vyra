import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Button, Chip, Pressable } from '../../components';
import { useTheme } from '../../theme';
import { useResponsive } from '../../hooks/useResponsive';
import { onboardingInterests } from '../../mock';
import type { RootScreenProps } from '../../navigation/types';

const slides = [
  {
    id: 'slide_1',
    image: 'https://picsum.photos/seed/onb1/800/1200',
    title: 'A feed that actually learns',
    body: 'What you watch, finish and rewatch shapes what comes next. Not follower counts.',
    icon: 'sparkles' as const,
  },
  {
    id: 'slide_2',
    image: 'https://picsum.photos/seed/onb2/800/1200',
    title: 'Create without leaving the app',
    body: 'Record, trim, filter, add music and publish. A full editor in your pocket.',
    icon: 'color-wand' as const,
  },
  {
    id: 'slide_3',
    image: 'https://picsum.photos/seed/onb3/800/1200',
    title: 'Everyone gets a real chance',
    body: 'Every new video is shown to a real test audience, whoever posted it.',
    icon: 'trending-up' as const,
  },
];

export function OnboardingScreen({ navigation }: RootScreenProps<'Onboarding'>) {
  const theme = useTheme();
  // Page width must track the live viewport — a value captured once broke paging
  // whenever the browser window was resized.
  const { width: pageWidth } = useWindowDimensions();
  const { isDesktop } = useResponsive();
  const [index, setIndex] = useState(0);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const listRef = useRef<FlatList>(null);

  const isInterestStep = index === slides.length;
  const totalSteps = slides.length + 1;

  const goTo = (next: number) => {
    listRef.current?.scrollToOffset({ offset: next * pageWidth, animated: true });
    setIndex(next);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    if (next !== index) setIndex(next);
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest],
    );
  };

  const pages = [...slides, { id: 'interests' } as const];

  return (
    <Screen dark background="#0A0A0B" fullBleed>
      <View style={styles.skipRow}>
        <Pressable onPress={() => navigation.replace('Login')} hitSlop={theme.layout.hitSlop}>
          <Text variant="label" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Skip
          </Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={pages}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => {
          if (item.id === 'interests') {
            return (
              <View style={[styles.page, { width: pageWidth, paddingHorizontal: theme.spacing.lg }]}>
                <Text variant="h1" tone="onDark" align="center">
                  What are you into?
                </Text>
                <Text
                  variant="label"
                  align="center"
                  style={{ color: 'rgba(255,255,255,0.6)', marginTop: theme.spacing.xs }}
                >
                  Pick at least three. This gives your feed a starting point — it keeps
                  learning from what you actually watch.
                </Text>

                <View style={styles.interestWrap}>
                  {onboardingInterests.map((interest) => (
                    <Chip
                      key={interest}
                      label={interest}
                      selected={selectedInterests.includes(interest)}
                      onPress={() => toggleInterest(interest)}
                      tone="brand"
                    />
                  ))}
                </View>
              </View>
            );
          }

          const slide = item as (typeof slides)[number];
          return (
            <View style={[styles.page, { width: pageWidth }]}>
              <Image source={{ uri: slide.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient
                colors={['rgba(10,10,11,0.35)', '#0A0A0B']}
                style={StyleSheet.absoluteFill}
              />
              <View style={[styles.slideContent, { paddingHorizontal: theme.spacing.lg }]}>
                <View style={[styles.slideIcon, { backgroundColor: theme.colors.brand }]}>
                  <Ionicons name={slide.icon} size={22} color="#FFF" />
                </View>
                <Text variant="h1" tone="onDark" align="center" style={{ marginTop: theme.spacing.lg }}>
                  {slide.title}
                </Text>
                <Text
                  variant="body"
                  align="center"
                  style={{ color: 'rgba(255,255,255,0.7)', marginTop: theme.spacing.sm, maxWidth: 320 }}
                >
                  {slide.body}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.footer, { paddingHorizontal: theme.spacing.lg, maxWidth: isDesktop ? 460 : undefined, alignSelf: 'center', width: '100%' }]}>
        <View style={styles.dots}>
          {pages.map((page, i) => (
            <View
              key={page.id}
              style={[
                styles.dot,
                {
                  backgroundColor: i === index ? theme.colors.brand : 'rgba(255,255,255,0.25)',
                  width: i === index ? 20 : 6,
                },
              ]}
            />
          ))}
        </View>

        <Button
          label={isInterestStep ? 'Get started' : 'Next'}
          variant="gradient"
          size="lg"
          fullWidth
          disabled={isInterestStep && selectedInterests.length < 3}
          onPress={() => (isInterestStep ? navigation.replace('Signup') : goTo(index + 1))}
          style={{ marginTop: theme.spacing.lg }}
        />

        <Pressable
          onPress={() => navigation.replace('Login')}
          style={{ marginTop: theme.spacing.md, alignSelf: 'center' }}
        >
          <Text variant="label" style={{ color: 'rgba(255,255,255,0.6)' }}>
            I already have an account
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skipRow: { alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 8, zIndex: 2 },
  page: { justifyContent: 'center' },
  slideContent: { alignItems: 'center', paddingBottom: 40 },
  slideIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 24 },
  footer: { paddingBottom: 32, paddingTop: 8 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  dot: { height: 6, borderRadius: 3 },
});
