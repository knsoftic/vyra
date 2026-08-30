import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme';
import { AppStateProvider } from './src/store/AppState';
import { SessionProvider } from './src/store/SessionState';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useRealtimeConnection } from './src/realtime';

/**
 * Owns the socket for the life of the app.
 *
 * It sits inside SessionProvider because the connection follows the session,
 * and outside the navigator so moving between screens never drops it — the
 * messages that arrive mid-navigation are exactly the ones worth keeping.
 */
function Realtime({ children }: { children: React.ReactNode }) {
  useRealtimeConnection();
  return <>{children}</>;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <AppStateProvider>
              <Realtime>
                <RootNavigator />
              </Realtime>
            </AppStateProvider>
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
