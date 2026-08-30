import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput } from 'react-native';
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
  VideoTile,
} from '../../components';
import { Slider } from '../../components/Controls';
import { useTheme } from '../../theme';
import { campaignObjectives, videos, estimateReach, walletBalance } from '../../mock';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { CampaignObjective } from '../../types';

type Step = 'objective' | 'audience' | 'budget' | 'creative' | 'review';

const STEPS: { id: Step; label: string }[] = [
  { id: 'objective', label: 'Objective' },
  { id: 'audience', label: 'Audience' },
  { id: 'budget', label: 'Budget' },
  { id: 'creative', label: 'Creative' },
  { id: 'review', label: 'Review' },
];

const countries = ['United States', 'United Kingdom', 'Germany', 'France', 'Pakistan', 'India', 'UAE', 'Canada'];
const languages = ['English', 'Urdu', 'German', 'French', 'Arabic', 'Spanish'];
const interests = ['Technology', 'Gaming', 'Business', 'Fashion', 'Food', 'Travel', 'Sports', 'Education'];
const devices = ['Mobile', 'Tablet'];
const operatingSystems = ['iOS', 'Android'];

export function CampaignBuilderScreen({ navigation }: RootScreenProps<'CampaignBuilder'>) {
  const theme = useTheme();

  const [step, setStep] = useState<Step>('objective');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<CampaignObjective>('reach');
  const [mode, setMode] = useState<'automatic' | 'custom' | 'broad'>('automatic');
  const [selectedCountries, setSelectedCountries] = useState<string[]>(['United States']);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['English']);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>(['Mobile']);
  const [selectedOs, setSelectedOs] = useState<string[]>(['iOS', 'Android']);
  const [ageRange, setAgeRange] = useState<[number, number]>([18, 54]);
  const [budget, setBudget] = useState(2400);
  const [days, setDays] = useState(14);
  const [creativeId, setCreativeId] = useState(videos[0].id);
  const [cta, setCta] = useState('Learn More');

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const reach = estimateReach(budget, days);
  const creative = videos.find((v) => v.id === creativeId) ?? videos[0];

  const toggle = (
    value: string,
    list: string[],
    setter: (next: string[]) => void,
  ) => setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const next = () => {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1].id);
    else navigation.navigate('Ads');
  };

  const back = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1].id);
    else navigation.goBack();
  };

  const TagGroup = ({
    label,
    options,
    selected,
    onToggle,
  }: {
    label: string;
    options: string[];
    selected: string[];
    onToggle: (value: string) => void;
  }) => (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <View style={styles.tagWrap}>
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            size="sm"
            tone="brand"
            selected={selected.includes(option)}
            onPress={() => onToggle(option)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <Screen>
      <Header title="New campaign" onBack={back} subtitle={`Step ${stepIndex + 1} of ${STEPS.length}`} />

      {/* Progress */}
      <View style={[styles.progressRow, { paddingHorizontal: theme.spacing.md }]}>
        {STEPS.map((item, index) => (
          <View
            key={item.id}
            style={[
              styles.progressSegment,
              {
                backgroundColor: index <= stepIndex ? theme.colors.brand : theme.colors.surfaceAlt,
              },
            ]}
          />
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {step === 'objective' ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
            <View>
              <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
                Campaign name
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Autumn launch"
                placeholderTextColor={theme.colors.textMuted}
                style={[
                  theme.typography.body,
                  styles.input,
                  { color: theme.colors.text, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
                ]}
              />
            </View>

            <Text variant="label" tone="secondary">
              What is the goal?
            </Text>
            <View style={{ gap: theme.spacing.xs }}>
              {campaignObjectives.map((item) => {
                const active = objective === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setObjective(item.id as CampaignObjective)}
                    style={[
                      styles.objectiveRow,
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
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{item.label}</Text>
                      <Text variant="caption" tone="muted">
                        {item.description}
                      </Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 'audience' ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.lg }}>
            <View style={styles.modeRow}>
              {(['automatic', 'custom', 'broad'] as const).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setMode(item)}
                  style={[
                    styles.modeCard,
                    {
                      backgroundColor: mode === item ? theme.colors.brandSoft : theme.colors.surface,
                      borderColor: mode === item ? theme.colors.brand : 'transparent',
                      borderRadius: theme.radius.md,
                    },
                  ]}
                >
                  <Text variant="labelStrong" style={styles.capitalize}>
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'automatic' ? (
              <Card padded>
                <View style={styles.noticeRow}>
                  <Ionicons name="sparkles-outline" size={16} color={theme.colors.accent} />
                  <Text variant="caption" tone="secondary" style={styles.flex}>
                    We find the people most likely to respond, using in-app behaviour only. You can
                    switch to custom targeting at any time.
                  </Text>
                </View>
              </Card>
            ) : mode === 'broad' ? (
              <Card padded>
                <View style={styles.noticeRow}>
                  <Ionicons name="globe-outline" size={16} color={theme.colors.info} />
                  <Text variant="caption" tone="secondary" style={styles.flex}>
                    Minimal targeting for maximum reach. Best for awareness campaigns.
                  </Text>
                </View>
              </Card>
            ) : (
              <View style={{ gap: theme.spacing.lg }}>
                <TagGroup
                  label="Countries"
                  options={countries}
                  selected={selectedCountries}
                  onToggle={(value) => toggle(value, selectedCountries, setSelectedCountries)}
                />
                <TagGroup
                  label="Languages"
                  options={languages}
                  selected={selectedLanguages}
                  onToggle={(value) => toggle(value, selectedLanguages, setSelectedLanguages)}
                />
                <TagGroup
                  label="Interests and categories"
                  options={interests}
                  selected={selectedInterests}
                  onToggle={(value) => toggle(value, selectedInterests, setSelectedInterests)}
                />
                <TagGroup
                  label="Device"
                  options={devices}
                  selected={selectedDevices}
                  onToggle={(value) => toggle(value, selectedDevices, setSelectedDevices)}
                />
                <TagGroup
                  label="Operating system"
                  options={operatingSystems}
                  selected={selectedOs}
                  onToggle={(value) => toggle(value, selectedOs, setSelectedOs)}
                />

                <View>
                  <View style={styles.sliderHeader}>
                    <Text variant="label" tone="secondary">
                      Age range
                    </Text>
                    <Text variant="label">
                      {ageRange[0]} – {ageRange[1]}
                    </Text>
                  </View>
                  <Slider
                    value={ageRange[1]}
                    min={18}
                    max={65}
                    onChange={(value) => setAgeRange([ageRange[0], Math.max(ageRange[0] + 1, value)])}
                  />
                  <Text variant="caption" tone="muted">
                    Age targeting is available only where local law permits it.
                  </Text>
                </View>
              </View>
            )}
          </View>
        ) : null}

        {step === 'budget' ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.lg }}>
            <Card padded style={{ gap: theme.spacing.md }}>
              <View>
                <View style={styles.sliderHeader}>
                  <Text variant="label" tone="secondary">
                    Total budget
                  </Text>
                  <Text variant="labelStrong">{budget.toLocaleString()} coins</Text>
                </View>
                <Slider
                  value={budget}
                  min={100}
                  max={20000}
                  onChange={(value) => setBudget(Math.round(value / 100) * 100)}
                />
              </View>

              <View>
                <View style={styles.sliderHeader}>
                  <Text variant="label" tone="secondary">
                    Duration
                  </Text>
                  <Text variant="labelStrong">{days} days</Text>
                </View>
                <Slider value={days} min={1} max={30} onChange={(value) => setDays(Math.max(1, Math.round(value)))} />
              </View>

              <Divider />

              <View style={styles.summaryRow}>
                <Text variant="label" tone="secondary" style={styles.flex}>
                  Daily budget
                </Text>
                <Text variant="label">{Math.round(budget / days).toLocaleString()} coins</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text variant="label" tone="secondary" style={styles.flex}>
                  Estimated reach
                </Text>
                <Text variant="label">
                  {formatCount(reach.min)} – {formatCount(reach.max)}
                </Text>
              </View>
            </Card>

            <Card padded>
              <View style={styles.noticeRow}>
                <Ionicons name="lock-closed-outline" size={16} color={theme.colors.success} />
                <Text variant="caption" tone="secondary" style={styles.flex}>
                  Your budget is a hard cap. Delivery stops when it is reached — a campaign can
                  never spend more than you set.
                </Text>
              </View>
            </Card>
          </View>
        ) : null}

        {step === 'creative' ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
            <Text variant="label" tone="secondary">
              Choose the video
            </Text>
            <View style={styles.creativeGrid}>
              {videos.slice(0, 9).map((item) => (
                <View key={item.id} style={creativeId === item.id ? styles.creativeActive : undefined}>
                  <VideoTile video={item} width={100} onPress={() => setCreativeId(item.id)} />
                </View>
              ))}
            </View>

            <Text variant="label" tone="secondary">
              Call to action
            </Text>
            <View style={styles.tagWrap}>
              {['Learn More', 'Shop Now', 'Sign Up', 'Download', 'Contact Us', 'Book Now'].map((item) => (
                <Chip key={item} label={item} size="sm" tone="brand" selected={cta === item} onPress={() => setCta(item)} />
              ))}
            </View>

            <View>
              <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
                Destination URL
              </Text>
              <TextInput
                placeholder="https://yoursite.com/landing"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                style={[
                  theme.typography.body,
                  styles.input,
                  { color: theme.colors.text, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
                ]}
              />
            </View>
          </View>
        ) : null}

        {step === 'review' ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
            <Card padded style={{ gap: theme.spacing.xs }}>
              {[
                { label: 'Name', value: name || 'Untitled campaign' },
                { label: 'Objective', value: campaignObjectives.find((o) => o.id === objective)?.label ?? '' },
                { label: 'Audience', value: mode },
                { label: 'Countries', value: mode === 'custom' ? selectedCountries.join(', ') || '—' : 'Automatic' },
                { label: 'Budget', value: `${budget.toLocaleString()} coins` },
                { label: 'Duration', value: `${days} days` },
                { label: 'Call to action', value: cta },
                { label: 'Estimated reach', value: `${formatCount(reach.min)} – ${formatCount(reach.max)}` },
                { label: 'Balance after', value: `${(walletBalance - budget).toLocaleString()} coins` },
              ].map((row) => (
                <View key={row.label} style={styles.summaryRow}>
                  <Text variant="label" tone="secondary" style={styles.flex}>
                    {row.label}
                  </Text>
                  <Text variant="label" numberOfLines={1} style={styles.summaryValue}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </Card>

            <Card padded>
              <Badge label="Review before delivery" tone="warning" size="sm" />
              <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
                Campaigns are checked against our advertising policies before they start running.
                You will be notified when the review completes.
              </Text>
            </Card>

            <Card padded>
              <View style={styles.noticeRow}>
                <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.success} />
                <Text variant="caption" tone="secondary" style={styles.flex}>
                  All engagement from this campaign comes from real people. The platform never
                  generates fake likes, followers or comments.
                </Text>
              </View>
            </Card>
          </View>
        ) : null}
      </ScrollView>

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
        {stepIndex > 0 ? (
          <Button label="Back" variant="outline" onPress={back} style={styles.flex} />
        ) : null}
        <Button
          label={step === 'review' ? 'Submit campaign' : 'Continue'}
          variant="gradient"
          onPress={next}
          style={styles.flex}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  capitalize: { textTransform: 'capitalize' },
  progressRow: { flexDirection: 'row', gap: 4, paddingBottom: 12 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2 },
  input: { height: 48, paddingHorizontal: 14 },
  objectiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1.5 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeCard: { flex: 1, alignItems: 'center', paddingVertical: 14, borderWidth: 1.5 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryValue: { maxWidth: '58%', textAlign: 'right' },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  creativeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  creativeActive: { borderWidth: 2, borderColor: '#FE2C55', borderRadius: 4 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
