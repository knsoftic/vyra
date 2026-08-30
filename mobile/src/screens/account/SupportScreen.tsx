import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  ListRow,
  Divider,
  Badge,
  Segmented,
  EmptyState,
  SectionHeader,
} from '../../components';
import { useTheme } from '../../theme';
import { supportTickets as sampleTickets, ticketCategories, faqs } from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { trust } from '../../api';
import type { SupportTicket } from '../../types';
import { timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { TicketStatus } from '../../types';

const statusTone: Record<TicketStatus, 'success' | 'warning' | 'neutral' | 'accent'> = {
  open: 'accent',
  in_progress: 'warning',
  waiting: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

const statusLabel: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function SupportScreen({ navigation }: RootScreenProps<'Support'>) {
  const { data: liveTickets, source } = useApiData(
    () =>
      trust.tickets().then((rows) =>
        rows.map<SupportTicket>((t) => ({
          id: t.id,
          subject: t.subject,
          category: t.category as SupportTicket['category'],
          status: t.status as SupportTicket['status'],
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          // The list endpoint does not carry conversations, so the count is
          // zero rather than a guess; opening a ticket fetches its messages.
          messageCount: t.messages.length,
        })),
      ),
    sampleTickets,
    [],
    // Having no tickets is a real answer, not an empty screen to fill.
    { fallbackOnEmpty: false },
  );

  const supportTickets = source === 'live' ? liveTickets : sampleTickets;

  const theme = useTheme();
  const [tab, setTab] = useState<'help' | 'tickets'>('help');
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Screen>
      <Header
        title="Help and support"
        right={
          <Pressable onPress={() => navigation.navigate('NewTicket')} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="add" size={24} color={theme.colors.text} />
          </Pressable>
        }
      />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'help', label: 'Help centre' },
            { id: 'tickets', label: `Tickets (${supportTickets.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <SourceNote source={source} noun="tickets" sampleHint="sign in to see your tickets" />

      {tab === 'help' ? (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <SectionHeader title="Common questions" />
          <Card>
            {faqs.map((faq, index) => {
              const open = expanded === faq.q;
              return (
                <View key={faq.q}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <Pressable
                    onPress={() => setExpanded(open ? null : faq.q)}
                    style={{ padding: theme.spacing.md }}
                  >
                    <View style={styles.faqHeader}>
                      <Text variant="body" style={styles.flex}>
                        {faq.q}
                      </Text>
                      <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={theme.colors.textMuted}
                      />
                    </View>
                    {open ? (
                      <Text variant="label" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
                        {faq.a}
                      </Text>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </Card>

          <SectionHeader title="Report a problem" />
          <Card>
            {ticketCategories.map((category, index) => (
              <View key={category.id}>
                {index > 0 ? <Divider inset={60} /> : null}
                <ListRow
                  label={category.label}
                  icon={category.icon as never}
                  onPress={() => navigation.navigate('NewTicket')}
                />
              </View>
            ))}
          </Card>

          <View style={{ padding: theme.spacing.md }}>
            <Button
              label="Open a support ticket"
              variant="gradient"
              fullWidth
              icon="chatbubbles-outline"
              onPress={() => navigation.navigate('NewTicket')}
            />
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={supportTickets}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title="No tickets yet"
              description="Open a ticket and our support team will get back to you."
              actionLabel="Open a ticket"
              onAction={() => navigation.navigate('NewTicket')}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.ticket,
                { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
              ]}
            >
              <View style={styles.flex}>
                <View style={styles.ticketHeader}>
                  <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                    {item.subject}
                  </Text>
                  <Badge label={statusLabel[item.status]} tone={statusTone[item.status]} size="sm" />
                </View>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  #{item.id} · {item.category} · updated {timeAgo(item.updatedAt)}
                </Text>
                <View style={styles.ticketMeta}>
                  <Ionicons name="chatbubble-outline" size={12} color={theme.colors.textMuted} />
                  <Text variant="caption" tone="muted">
                    {item.messageCount} messages
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

export function NewTicketScreen({ navigation }: RootScreenProps<'NewTicket'>) {
  const theme = useTheme();
  const [category, setCategory] = useState<string>(ticketCategories[0].id);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Screen>
        <Header title="Ticket created" showBack={false} />
        <View style={styles.center}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="We got it"
            description="Your ticket has been created. Support usually replies within one business day, and you will get a notification when they do."
          />
          <View style={{ paddingHorizontal: theme.spacing.xl, width: '100%' }}>
            <Button label="Back to support" variant="gradient" fullWidth onPress={() => navigation.goBack()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="New ticket" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }}
        >
          CATEGORY
        </Text>
        <View style={[styles.categoryWrap, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }]}>
          {ticketCategories.map((item) => {
            const active = category === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setCategory(item.id)}
                style={[
                  styles.categoryCard,
                  {
                    backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                    borderColor: active ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Ionicons
                  name={item.icon as never}
                  size={18}
                  color={active ? theme.colors.brand : theme.colors.textSecondary}
                />
                <Text variant="caption" numberOfLines={2} align="center">
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
          <View>
            <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
              Subject
            </Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Short summary of the problem"
              placeholderTextColor={theme.colors.textMuted}
              style={[
                theme.typography.body,
                styles.input,
                { color: theme.colors.text, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
              ]}
            />
          </View>

          <View>
            <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
              Description
            </Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="What happened, what you expected, and when it started. Include a transaction reference if this is about coins or payments."
              placeholderTextColor={theme.colors.textMuted}
              multiline
              style={[
                theme.typography.body,
                styles.textarea,
                { color: theme.colors.text, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
              ]}
            />
          </View>

          <Card padded>
            <Pressable style={styles.attachRow}>
              <Ionicons name="attach-outline" size={18} color={theme.colors.textSecondary} />
              <Text variant="label" tone="secondary" style={styles.flex}>
                Attach a screenshot or screen recording
              </Text>
              <Ionicons name="add" size={18} color={theme.colors.brand} />
            </Pressable>
          </Card>
        </View>
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
        <Button
          label="Submit ticket"
          variant="gradient"
          size="lg"
          fullWidth
          disabled={!subject.trim() || !body.trim()}
          onPress={() => setSent(true)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  faqHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryCard: {
    width: '31.5%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderWidth: 1.5,
  },
  input: { height: 48, paddingHorizontal: 14 },
  textarea: { minHeight: 140, padding: 14, textAlignVertical: 'top' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
