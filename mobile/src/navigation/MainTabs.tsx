import React from 'react';
import { StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useResponsive } from '../hooks/useResponsive';
import { Text } from '../components/Text';
import { HomeScreen } from '../screens/feed/HomeScreen';
import { ExploreScreen } from '../screens/discover/ExploreScreen';
import { InboxScreen } from '../screens/inbox/InboxScreen';
import { MyProfileScreen } from '../screens/profile/ProfileScreen';
import { chats, notifications } from '../mock';
import type { MainTabParamList, RootStackParamList } from './types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * The Create tab never renders: its `tabPress` is intercepted and routed into the
 * creation flow. It exists only so the button sits in the navigation bar.
 */
function CreateRouteStub() {
  return null;
}

/** Gradient plus button — circular on mobile, a labelled row item on desktop. */
function CreateButton({ desktop }: { desktop: boolean }) {
  const theme = useTheme();
  return (
    <LinearGradient
      colors={[...theme.gradients.brandAccent]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={desktop ? styles.createButtonDesktop : styles.createButton}
    >
      <Ionicons name="add" size={desktop ? 18 : 26} color="#FFFFFF" />
    </LinearGradient>
  );
}

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text variant="caption" tone={focused ? 'primary' : 'muted'} numberOfLines={1}>
      {label}
    </Text>
  );
}

/**
 * Primary navigation.
 *
 * Mobile gets a bottom tab bar; desktop web gets a left sidebar (ADR-016 — the two
 * platforms never share a navigation pattern). React Navigation's `tabBarPosition`
 * keeps the same routes and state across both.
 */
export function MainTabs() {
  const theme = useTheme();
  const { isDesktop } = useResponsive();

  const unreadInbox =
    chats.reduce((sum, chat) => sum + chat.unreadCount, 0) +
    notifications.filter((n) => !n.read).length;

  const sidebarStyle = {
    backgroundColor: theme.colors.tabBar,
    borderRightColor: theme.colors.tabBarBorder,
    borderRightWidth: StyleSheet.hairlineWidth,
    width: 224,
    paddingTop: 12,
    paddingHorizontal: 8,
  };

  const bottomBarStyle = {
    backgroundColor: theme.colors.tabBar,
    borderTopColor: theme.colors.tabBarBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: theme.layout.tabBarHeight + (Platform.OS === 'ios' ? 28 : 8),
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 26 : 6,
  };

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Sidebar on desktop web, bottom bar on phones (ADR-016).
        tabBarPosition: isDesktop ? 'left' : 'bottom',
        tabBarStyle: isDesktop ? sidebarStyle : bottomBarStyle,
        tabBarLabelPosition: isDesktop ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: isDesktop ? theme.colors.brand : theme.colors.text,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarItemStyle: isDesktop
          ? { borderRadius: theme.radius.md, marginBottom: 4, justifyContent: 'flex-start' }
          : undefined,
        tabBarActiveBackgroundColor: isDesktop ? theme.colors.brandSoft : undefined,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Home" focused={focused} />,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Explore"
        component={ExploreScreen}
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Explore" focused={focused} />,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={24} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Create"
        component={CreateRouteStub}
        options={{
          tabBarLabel: isDesktop
            ? ({ focused }) => <TabLabel label="Create" focused={focused} />
            : () => null,
          tabBarIcon: () => <CreateButton desktop={isDesktop} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            // Creation is a modal flow on the root stack, not a tab destination.
            event.preventDefault();
            (navigation as unknown as RootNavigation).navigate('Record');
          },
        })}
      />

      <Tab.Screen
        name="Inbox"
        component={InboxScreen}
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Inbox" focused={focused} />,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
              size={23}
              color={color}
            />
          ),
          // Built-in badge — positions correctly whether the bar is at the bottom
          // or on the left. A hand-placed overlay collided with the sidebar label.
          tabBarBadge: unreadInbox > 0 ? unreadInbox : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.brand,
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: '700',
            minWidth: 16,
            height: 16,
            lineHeight: 16,
          },
        }}
      />

      <Tab.Screen
        name="ProfileTab"
        component={MyProfileScreen}
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Profile" focused={focused} />,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={23} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  // Circular and raised — not the wide rounded rectangle of the obvious reference.
  createButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
  },
  createButtonDesktop: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
