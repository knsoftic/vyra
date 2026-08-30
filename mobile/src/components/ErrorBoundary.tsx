import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';

/**
 * The last line of defence.
 *
 * Without this, any render error in a production build unwinds past React into
 * the native layer and the app simply closes — no message, nothing the person
 * can report, nothing anyone can debug. That is what "the app crashed" means to
 * a user, and it is the least useful failure a program can have.
 *
 * So: catch it, show what actually went wrong, and offer a way back. The
 * message is deliberately shown in full rather than replaced with an apology —
 * the one person who can tell a developer what happened is the person looking
 * at the screen.
 *
 * Colours are hardcoded because this must render even if the theme provider is
 * what failed.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Also goes to the console, so `adb logcat` / Xcode / the Expo dev client
    // shows it with the full component stack.
    console.error('Unhandled error:', error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  reset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): React.ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.lead}>
            The app hit an error it could not recover from. The details below are what actually
            happened — sending them to support is the fastest way to get it fixed.
          </Text>

          <View style={styles.box}>
            <Text style={styles.errorName}>{error.name}</Text>
            <Text style={styles.errorMessage}>{error.message}</Text>
          </View>

          {info ? (
            <View style={styles.box}>
              <Text style={styles.stackLabel}>Where it happened</Text>
              <Text style={styles.stack}>{info.trim().split('\n').slice(0, 12).join('\n')}</Text>
            </View>
          ) : null}

          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>

          <Text style={styles.note}>
            If it keeps happening, close and reopen the app. Your account and everything in it is
            safe — this is a display problem, not lost data.
          </Text>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0B' },
  content: { padding: 24, paddingTop: Platform.OS === 'ios' ? 72 : 48, gap: 16 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  lead: { color: '#9CA3AF', fontSize: 14, lineHeight: 21 },
  box: { backgroundColor: '#17171A', borderRadius: 12, padding: 14, gap: 6 },
  errorName: { color: '#F87171', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  errorMessage: { color: '#E5E7EB', fontSize: 14, lineHeight: 20 },
  stackLabel: { color: '#6B7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  stack: { color: '#9CA3AF', fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  button: {
    backgroundColor: '#6D5AE6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  note: { color: '#6B7280', fontSize: 12, lineHeight: 18 },
});
