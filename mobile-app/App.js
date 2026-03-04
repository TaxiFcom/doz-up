import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, StyleSheet, StatusBar, LogBox } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Screens
import HomeScreen from './src/screens/HomeScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import EditorScreen from './src/screens/EditorScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import ShareScreen from './src/screens/ShareScreen';
import ReferralScreen from './src/screens/ReferralScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import SplashScreen from './src/screens/SplashScreen';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';

// Services
import NotificationService from './src/services/NotificationService';
import AnalyticsService from './src/services/AnalyticsService';
import { API_BASE_URL, STRIPE_PUBLISHABLE_KEY } from './src/config';

LogBox.ignoreLogs(['Reanimated 2', 'Remote debugger']);

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function TabNavigator() {
  const { theme } = useTheme();
  const { user } = useAuth();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          height: 70,
          paddingBottom: 10,
          paddingTop: 5,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Capture"
        component={CaptureScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <View style={[styles.captureIcon, { backgroundColor: theme.primary }]}>
              <Icon name="camera" size={24} color="#fff" />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tab.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="image-multiple" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Referrals"
        component={ReferralScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="gift" size={size} color={color} />
          ),
          tabBarBadge: user?.referralCount > 0 ? user.referralCount : null,
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.container}>
        <SplashScreen />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="Editor" component={EditorScreen} />
          <Stack.Screen name="Share" component={ShareScreen} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize services
      await NotificationService.initialize();
      await AnalyticsService.initialize();
      
      // Load settings
      const settings = await AsyncStorage.getItem('app_settings');
      if (settings) {
        // Apply saved settings
      }

      setIsReady(true);
    } catch (error) {
      console.error('App initialization error:', error);
      setIsReady(true);
    }
  };

  if (!isReady) {
    return (
      <View style={styles.container}>
        <SplashScreen />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
                <NavigationContainer>
                  <StatusBar
                    barStyle="light-content"
                    backgroundColor="transparent"
                    translucent
                  />
                  <AppNavigator />
                </NavigationContainer>
              </StripeProvider>
            </SubscriptionProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a12',
  },
  captureIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -20,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});

export default App;
