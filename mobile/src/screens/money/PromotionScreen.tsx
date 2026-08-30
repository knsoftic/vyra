import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  Chip,
  Badge,
  Divider,
  Sheet,
  VideoTile,
} from '../../components';
import { Slider } from '../../components/Controls';
import { useTheme } from '../../theme';
import {
  videos,
  myVideos,
  campaignObjectives,
  boostSettings,
  estimateReach,
  walletBalance,
} from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { promotion, money, moneyKey, videos as videosApi, toVideo, ApiError } from '../../api';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { CampaignObjective } from '../../types';

export function PromotionScreen({ navigation, route }: RootScreenProps<'Promotion'>) {
  const theme = useTheme();

  const initial = route.params?.videoId
    ? videos.find((v) => v.id === route.params.videoId)
    : myVideos[0] ?? videos[0];

  const [video, setVideo] = useState(initial ?? videos[0]);
  const [objective, setObjective] = useState<CampaignObjective>('video_views');
  const [audience, setAudience] = useState<'automatic' | 'custom' | 'broad'>('automatic');
  const [coins, setCoins] = useState(1200);
  const [days, setDays] = useState(7);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /**
   * The wallet, the videos and the forecast all come from the server.
   *
   * The balance especially: offering to spend coins the account does not have
   * produces a refusal at the last step, after the user has made every other
   * choice.
   */
  const { data: liveBalances, source: balanceSource } = useApiData(() => money.balances(), null, []);
  const { data: liveVideos, source: videoSource } = useApiData(
    () => videosApi.mine(30).then((rows) => rows.map((v) => toVideo(v))),
    [],
    [],
  );

  const live = balanceSource === 'live';
  const availableCoins = live && liveBalances ? liveBalances.coin : walletBalance;
  const canAfford = coins <= availableCoins;

  const [estimateState, setEstimate] = useState<{
    reachMin: number;
    reachMax: number;
    disclaimer: string;
  } | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Re-forecast whenever the budget, duration or audience changes. The server
  // owns the arithmetic, so the number shown is the one it would stand behind.
  useEffect(() => {
    if (!live) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    void promotion
      .estimate(coins, days, { mode: audience })
      .then((result) => {
        if (cancelled) return;
        setEstimate({
          reachMin: result.estimatedReachMin,
          reachMax: result.estimatedReachMax,
          disclaimer: result.disclaimer,
        });
      })
      .catch(() => {
        if (!cancelled) setEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [live, coins, days, audience]);

  const sampleReach = estimateReach(coins, days);
  const reach = estimateState
    ? {
        min: estimateState.reachMin,
        max: estimateState.reachMax,
        perDay: days > 0 ? Math.floor(estimateState.reachMax / days) : estimateState.reachMax,
      }
    : sampleReach;

  /**
   * Starts the promotion.
   *
   * The budget leaves the wallet the moment this succeeds and is held until the
   * campaign ends, so the key is created once here — a retry must find the
   * original campaign rather than fund a second one.
   */
  const launch = () => {
    if (!live) {
      setConfirming(false);
      navigation.navigate('Ads');
      return;
    }
    setLaunching(true);
    setLaunchError(null);

    void promotion
      .create(
        {
          name: `Promotion: ${video.caption.slice(0, 60) || 'video'}`,
          videoId: video.id,
          objective,
          budgetCoins: coins,
          durationDays: days,
          targeting: { mode: audience },
        },
        moneyKey('promotion'),
      )
      .then(() => {
        setConfirming(false);
        navigation.navigate('Ads');
      })
      .catch((err: unknown) => {
        setLaunchError(err instanceof ApiError ? err.message : 'The promotion could not start.');
      })
      .finally(() => setLaunching(false));
  };

  return (
    <Screen>
      <Header title="Promote video" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        <SourceNote
          source={live ? 'live' : 'sample'}
          noun="wallet and forecast"
          sampleHint="sign in to promote with real coins"
        />
        {/* Video selection */}
        <Pressable
          onPress={() => setPicking(true)}
          style={[
            styles.videoRow,
            {
              backgroundColor: theme.colors.surface,
              margin: theme.spacing.md,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.sm,
            },
          ]}
        >
          <Image
            source={{ uri: video.poster }}
            style={[styles.poster, { borderRadius: theme.radius.sm }]}
            contentFit="cover"
          />
          <View style={styles.flex}>
            <Text variant="label" numberOfLines={2}>
              {video.caption}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {formatCount(video.stats.views)} views · {formatCount(video.stats.likes)} likes
            </Text>
          </View>
          <Ionicons name="swap-horizontal" size={18} color={theme.colors.textMuted} />
        </Pressable>

        {/* Objective */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs }}
        >
          WHAT DO YOU WANT?
        </Text>
        <View style={[styles.objectives, { paddingHorizontal: theme.spacing.md }]}>
          {campaignObjectives.slice(0, 7).map((item) => {
            const active = objective === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setObjective(item.id as CampaignObjective)}
                style={[
                  styles.objective,
                  {
                    backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                    borderColor: active ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Ionicons
                  name={item.icon as never}
                  size={20}
                  color={active ? theme.colors.brand : theme.colors.textSecondary}
                />
                <Text variant="caption" numberOfLines={2} align="center">
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Audience */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          AUDIENCE
        </Text>
        <View style={[styles.audienceRow, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }]}>
          {(
            [
              { id: 'automatic', label: 'Automatic', hint: 'We pick the audience' },
              { id: 'custom', label: 'Custom', hint: 'You choose targeting' },
              { id: 'broad', label: 'Broad', hint: 'Maximum reach' },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setAudience(item.id)}
              style={[
                styles.audienceCard,
                {
                  backgroundColor: audience === item.id ? theme.colors.brandSoft : theme.colors.surface,
                  borderColor: audience === item.id ? theme.colors.brand : 'transparent',
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text variant="labelStrong">{item.label}</Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {item.hint}
              </Text>
            </Pressable>
          ))}
        </View>

        {audience === 'custom' ? (
          <Card style={{ marginTop: theme.spacing.sm }}>
            <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
              {['Countries', 'Cities', 'Languages', 'Interests', 'Device'].map((label) => (
                <View key={label} style={styles.targetRow}>
                  <Text variant="label" tone="secondary" style={styles.flex}>
                    {label}
                  </Text>
                  <Text variant="label" tone="brand">
                    Select
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Budget */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          BUDGET AND DURATION
        </Text>
        <Card padded style={{ marginTop: theme.spacing.xs, gap: theme.spacing.md }}>
          <View>
            <View style={styles.sliderHeader}>
              <Text variant="label" tone="secondary">
                Total coins
              </Text>
              <Text variant="labelStrong">{coins.toLocaleString()}</Text>
            </View>
            <Slider
              value={coins}
              min={boostSettings.minCoins}
              max={10000}
              onChange={(value) => setCoins(Math.round(value / 100) * 100)}
            />
            <View style={styles.rangeRow}>
              <Text variant="caption" tone="muted">
                {boostSettings.minCoins}
              </Text>
              <Text variant="caption" tone="muted">
                10,000
              </Text>
            </View>
          </View>

          <View>
            <View style={styles.sliderHeader}>
              <Text variant="label" tone="secondary">
                Duration
              </Text>
              <Text variant="labelStrong">
                {days} day{days === 1 ? '' : 's'}
              </Text>
            </View>
            <Slider
              value={days}
              min={boostSettings.minDurationDays}
              max={boostSettings.maxDurationDays}
              onChange={(value) => setDays(Math.max(1, Math.round(value)))}
            />
          </View>
        </Card>

        {/* Estimate */}
        <Card padded style={{ marginTop: theme.spacing.md }}>
          <View style={styles.estimateHeader}>
            <Ionicons name="stats-chart-outline" size={16} color={theme.colors.accent} />
            <Text variant="bodyStrong" style={styles.flex}>
              Estimated results
            </Text>
          </View>
          <Text variant="h2" style={{ marginTop: theme.spacing.xs }}>
            {formatCount(reach.min)} – {formatCount(reach.max)}
          </Text>
          <Text variant="caption" tone="muted">
            people reached · about {formatCount(reach.perDay)} per day
          </Text>

          <Divider />

          <View style={[styles.noticeRow, { marginTop: theme.spacing.sm }]}>
            <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.success} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Promotion buys distribution to real, relevant people. It never adds fake likes,
              followers or comments. All engagement you receive is genuine.
            </Text>
          </View>
        </Card>
      </ScrollView>

      {/* Footer */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.colors.bg,
            borderTopColor: theme.colors.border,
            padding: theme.spacing.md,
          },
        ]}
      >
        <View style={styles.flex}>
          <Text variant="caption" tone="muted">
            Total cost
          </Text>
          <View style={styles.costRow}>
            <Ionicons name="logo-bitcoin" size={15} color={theme.colors.gold} />
            <Text variant="h3">{coins.toLocaleString()}</Text>
          </View>
        </View>
        <Button
          label={canAfford ? 'Start promotion' : 'Buy coins'}
          variant="gradient"
          size="lg"
          onPress={() => (canAfford ? setConfirming(true) : navigation.navigate('BuyCoins'))}
        />
      </View>

      {/* Video picker */}
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Choose a video" height={0.6} showClose>
        <ScrollView contentContainerStyle={[styles.pickerGrid, { padding: theme.spacing.md }]}>
          {(videoSource === 'live' ? liveVideos : videos).map((item) => (
            <VideoTile
              key={item.id}
              video={item}
              width={100}
              onPress={() => {
                setVideo(item);
                setPicking(false);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>

      {/* Confirm */}
      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Confirm promotion" height={0.5} showClose>
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
          {[
            { label: 'Objective', value: campaignObjectives.find((o) => o.id === objective)?.label ?? '' },
            { label: 'Audience', value: audience },
            { label: 'Budget', value: `${coins.toLocaleString()} coins` },
            { label: 'Duration', value: `${days} days` },
            { label: 'Estimated reach', value: `${formatCount(reach.min)} – ${formatCount(reach.max)}` },
            { label: 'Balance after', value: `${(walletBalance - coins).toLocaleString()} coins` },
          ].map((row) => (
            <View key={row.label} style={styles.targetRow}>
              <Text variant="label" tone="secondary" style={styles.flex}>
                {row.label}
              </Text>
              <Text variant="label">{row.value}</Text>
            </View>
          ))}

          <Badge label="Reviewed before it runs" tone="warning" size="sm" />
          <Text variant="caption" tone="muted">
            Promotions are checked against our advertising policies before delivery starts. This
            usually takes under an hour.
          </Text>

          {launchError ? (
            <Text variant="caption" tone="danger">
              {launchError}
            </Text>
          ) : null}

          <Button
            label="Confirm and start"
            variant="gradient"
            fullWidth
            loading={launching}
            onPress={launch}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  poster: { width: 56, height: 74 },
  objectives: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  objective: {
    width: '31.5%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderWidth: 1.5,
  },
  audienceRow: { flexDirection: 'row', gap: 8 },
  audienceCard: { flex: 1, padding: 12, borderWidth: 1.5, gap: 2 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  estimateHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
