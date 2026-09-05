import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts as useInter,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';

import HomeScreen from './src/screens/HomeScreen';
import RecipesScreen from './src/screens/RecipesScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import PantryScreen from './src/screens/PantryScreen';
import UseFirstScreen from './src/screens/UseFirstScreen';
import AddFoodScreen from './src/screens/AddFoodScreen';
import FoodDetailScreen from './src/screens/FoodDetailScreen';
import RecordOutcomeScreen from './src/screens/RecordOutcomeScreen';
import MarkConsumedScreen from './src/screens/MarkConsumedScreen';
import MarkWastedScreen from './src/screens/MarkWastedScreen';
import WasteRecordedScreen from './src/screens/WasteRecordedScreen';
import BottomNav from './src/components/BottomNav';
import AnimatedLoadingScreen from './src/components/AnimatedLoadingScreen';
import ConfirmDialog from './src/components/ConfirmDialog';
import { colors, fonts, radii, spacing } from './src/theme/theme';
import { registerDevice } from './src/api/freshwise';
import { isFreshInstall, checkClipboardForDeviceId, adoptDeviceId, copyDeviceIdToClipboard } from './src/api/device';

SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// The 4 tabs, shown behind the bottom nav bar.
function MainTabs() {
  return (
    <Tab.Navigator
      id={undefined}
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomNav {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Pantry" component={PantryScreen} />
      <Tab.Screen name="UseFirst" component={UseFirstScreen} />
      <Tab.Screen name="Recipes" component={RecipesScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useInter({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    DMSerifDisplay_400Regular,
  });

  // Every pantry/logs/diet request 404s until this device has a profile -- see
  // src/api/freshwise.ts's registerDevice() and backend/README.md's "Identity model".
  const [deviceReady, setDeviceReady] = useState(false);

  // If a clipboard-restore candidate is found (see below), startup pauses here
  // until the user answers this prompt -- neither registerDevice() nor
  // setDeviceReady() run until they do.
  const [restorePromptId, setRestorePromptId] = useState<string | null>(null);

  // Brief confirmation that the current id was just copied -- so the user
  // never has to remember to do it manually before deleting the app.
  const [copyToast, setCopyToast] = useState(false);
  useEffect(() => {
    if (!copyToast) return;
    const timeout = setTimeout(() => setCopyToast(false), 2500);
    return () => clearTimeout(timeout);
  }, [copyToast]);

  const finishDeviceInit = useCallback(() => {
    registerDevice()
      .then(() => {
        // Opportunistic, not gated behind any explicit user action: every
        // successful launch leaves a valid id sitting in the clipboard, so
        // whenever a reinstall becomes necessary (SDK bump, etc.) one is
        // already there without the user needing to remember to copy it
        // themselves beforehand.
        copyDeviceIdToClipboard()
          .then(() => setCopyToast(true))
          .catch(() => {});
      })
      .catch(() => {
        // Swallowed deliberately: every request already sends the device header
        // regardless (see src/api/client.ts), so a later request just 404s and
        // surfaces its own error rather than blocking app startup forever if the
        // API happens to be unreachable right at launch.
      })
      .finally(() => setDeviceReady(true));
  }, []);

  useEffect(() => {
    (async () => {
      // Only ever checks the clipboard on a genuinely fresh install -- a
      // normal launch (existing id already in AsyncStorage) skips this
      // entirely and never touches the clipboard or shows a prompt.
      if (await isFreshInstall()) {
        const candidate = await checkClipboardForDeviceId();
        if (candidate) {
          setRestorePromptId(candidate); // pauses startup -- see the dialog below
          return;
        }
      }
      finishDeviceInit();
    })();
  }, [finishDeviceInit]);

  const handleRestoreConfirm = () => {
    if (!restorePromptId) return;
    adoptDeviceId(restorePromptId).finally(() => {
      setRestorePromptId(null);
      finishDeviceInit();
    });
  };

  const handleRestoreDecline = () => {
    setRestorePromptId(null);
    finishDeviceInit();
  };

  const appReady = fontsLoaded && deviceReady;

  // Safety net for the (rare) case fonts + registration both resolve before this
  // component's very first paint -- then AnimatedLoadingScreen below is skipped
  // entirely, so its own onLayout never fires to hide the native splash.
  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await SplashScreen.hideAsync();
    }
  }, [appReady]);

  if (!appReady) {
    if (restorePromptId) {
      // Rendered in place of the loading screen, not alongside it -- startup
      // is genuinely paused here until the user answers.
      return (
        <View style={styles.restorePromptBackdrop}>
          <ConfirmDialog
            visible
            title="Restore your pantry?"
            message="We found a device ID in your clipboard from a previous install. Restore it to get your old pantry back, or start fresh instead."
            confirmLabel="Restore"
            confirmColor={colors.primary}
            onConfirm={handleRestoreConfirm}
            onCancel={handleRestoreDecline}
          />
        </View>
      );
    }
    // Hides the native (static, un-animatable) splash as soon as this screen has
    // painted its first frame, so what the user actually sees while fonts/device
    // registration finish is the pulsing logo animation, not a frozen image.
    return <AnimatedLoadingScreen onLayout={() => SplashScreen.hideAsync()} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
          {copyToast ? (
            <View style={styles.toast} pointerEvents="none">
              <View style={styles.toastPill}>
                <Text style={styles.toastText}>Device ID copied</Text>
              </View>
            </View>
          ) : null}
          <NavigationContainer>
            <Stack.Navigator id={undefined} screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Group screenOptions={{ presentation: 'modal' }}>
                <Stack.Screen name="AddFood" component={AddFoodScreen} />
                <Stack.Screen name="FoodDetail" component={FoodDetailScreen} />
                <Stack.Screen name="RecordOutcome" component={RecordOutcomeScreen} />
                <Stack.Screen name="MarkConsumed" component={MarkConsumedScreen} />
                <Stack.Screen name="MarkWasted" component={MarkWastedScreen} />
                <Stack.Screen name="WasteRecorded" component={WasteRecordedScreen} />
              </Stack.Group>
            </Stack.Navigator>
          </NavigationContainer>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  restorePromptBackdrop: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toast: {
    position: 'absolute',
    top: spacing.lg,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  toastPill: {
    backgroundColor: colors.toastSuccessBg,
    borderRadius: radii.pill,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toastText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.white,
  },
});