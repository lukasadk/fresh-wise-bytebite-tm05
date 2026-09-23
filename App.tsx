import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Platform, StyleSheet } from 'react-native';
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
import {
  Lato_400Regular,
  Lato_400Regular_Italic,
  Lato_700Bold,
  Lato_700Bold_Italic,
} from '@expo-google-fonts/lato';

import HomeScreen from './src/screens/HomeScreen';
import RecipesScreen from './src/screens/RecipesScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import PantryScreen from './src/screens/PantryScreen';
import UseFirstScreen from './src/screens/UseFirstScreen';
import AddFoodScreen from './src/screens/AddFoodScreen';
import AddFoodChoiceScreen from './src/screens/AddFoodChoiceScreen';
import PhotoGroceryScreen from './src/screens/ApiGroceryScreen';
import SmartAddFoodScreen from './src/screens/SmartAddFoodScreen';
import FoodDetailScreen from './src/screens/FoodDetailScreen';
import RecordOutcomeScreen from './src/screens/RecordOutcomeScreen';
import MarkConsumedScreen from './src/screens/MarkConsumedScreen';
import MarkWastedScreen from './src/screens/MarkWastedScreen';
import WasteRecordedScreen from './src/screens/WasteRecordedScreen';
import RecipeConsumeScreen from './src/screens/RecipeConsumeScreen';
import ScanGroceriesScreen from './src/screens/ScanGroceriesScreen';
import ScanningGroceriesScreen from './src/screens/ScanningGroceriesScreen';
import DetectionCompleteScreen from './src/screens/DetectionCompleteScreen';
import ReviewDetectedItemsScreen from './src/screens/ReviewDetectedItemsScreen';
import EditDetectedItemScreen from './src/screens/EditDetectedItemScreen';
import BottomNav from './src/components/BottomNav';
import LandingScreen from './src/components/LandingScreen';
import ConfirmDialog from './src/components/ConfirmDialog';
import { colors, fonts, radii, spacing } from './src/theme/theme';
import { registerDevice } from './src/api/freshwise';
import { isFreshInstall, checkClipboardForDeviceId, adoptDeviceId, copyDeviceIdToClipboard } from './src/api/device';
import {
  canEnterApp,
  STARTUP_FONT_FAIL_OPEN_MS,
  STARTUP_IDENTITY_FAIL_OPEN_MS,
} from './src/startup/readiness';

SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const UI_PREVIEW_MODE = Platform.OS === 'web'
  && __DEV__
  && (
    process.env.EXPO_PUBLIC_WASTEWISE_UI_PREVIEW === '1'
    || (
      typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('preview') === '1'
    )
  );

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
  const [fontsLoaded, fontLoadError] = useInter({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    DMSerifDisplay_400Regular,
    Lato_400Regular,
    Lato_400Regular_Italic,
    Lato_700Bold,
    Lato_700Bold_Italic,
  });
  const [fontDeadlineReached, setFontDeadlineReached] = useState(UI_PREVIEW_MODE);

  useEffect(() => {
    if (UI_PREVIEW_MODE || fontsLoaded || fontLoadError) return;
    const timeout = setTimeout(
      () => setFontDeadlineReached(true),
      STARTUP_FONT_FAIL_OPEN_MS,
    );
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontLoadError]);

  // Every pantry/logs/diet request 404s until this device has a profile -- see
  // src/api/freshwise.ts's registerDevice() and backend/README.md's "Identity model".
  const [deviceReady, setDeviceReady] = useState(UI_PREVIEW_MODE);
  const deviceInitStarted = useRef(UI_PREVIEW_MODE);

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
    if (deviceInitStarted.current) return;
    deviceInitStarted.current = true;

    // The photo model and the rest of the local UI must remain available when
    // Railway is sleeping, offline, or blocked. Release the startup gate now;
    // remote registration continues opportunistically in the background.
    setDeviceReady(true);
    void registerDevice()
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
        // A later online request surfaces its own error; startup and offline
        // grocery recognition have already been released above.
      });
  }, []);

  useEffect(() => {
    if (UI_PREVIEW_MODE) return;
    let cancelled = false;
    const failOpen = setTimeout(() => {
      if (!cancelled) finishDeviceInit();
    }, STARTUP_IDENTITY_FAIL_OPEN_MS);

    (async () => {
      try {
        // Only ever checks the clipboard on a genuinely fresh install -- a
        // normal launch (existing id already in AsyncStorage) skips this.
        if (await isFreshInstall()) {
          const candidate = await checkClipboardForDeviceId();
          if (cancelled || deviceInitStarted.current) return;
          if (candidate) {
            clearTimeout(failOpen);
            setRestorePromptId(candidate);
            return;
          }
        }
      } catch {
        // Local identity/clipboard failures must not trap the launch screen.
      }
      if (!cancelled) {
        clearTimeout(failOpen);
        finishDeviceInit();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(failOpen);
    };
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

  const appReady = canEnterApp({
    fontsLoaded,
    fontLoadFailed: !!fontLoadError,
    fontDeadlineReached,
    deviceReady,
  });

  // The landing overlay is unmounted only once ITS OWN exit-fade animation
  // finishes (see onExitComplete below) -- not the instant "Get Started" is
  // tapped. This is what lets its fade-out play in full instead of being cut
  // short by the overlay disappearing mid-animation.
  const [landingDismissed, setLandingDismissed] = useState(UI_PREVIEW_MODE);

  // Starts at 0 and fades to 1 -- but critically, the main app tree below is
  // mounted (at opacity 0, not interactive) as soon as appReady is true,
  // WELL BEFORE "Get Started" is ever tapped. That's the actual fix: the
  // previous version only started building the whole navigation tree (plus
  // Home's first data fetch) at the moment of the tap, and that mount+fetch
  // cost was slow enough to finish AFTER the fade-in's opacity had already
  // reached 1, making the fade invisible in practice even though the
  // animation itself was running correctly. Pre-mounting in the background
  // means by the time the tap happens, there's nothing left to wait for --
  // the fade is a pure, already-loaded crossfade.
  const mainAppFade = useRef(new Animated.Value(UI_PREVIEW_MODE ? 1 : 0)).current;
  const startMainAppFadeIn = useCallback(() => {
    Animated.timing(mainAppFade, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mainAppFade]);

  // Safety net for the (rare) case this fires before the fade above has
  // visibly started -- harmless either way, native splash hiding is a no-op
  // once already hidden.
  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await SplashScreen.hideAsync();
    }
  }, [appReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1 }}>
          {/* Main app tree -- pre-mounted in the background the moment
              appReady is true, regardless of whether the landing overlay is
              still showing on top. Starts fully transparent and
              non-interactive (pointerEvents "none") so it can't be tapped
              through the overlay while hidden. */}
          {appReady && (
            <Animated.View
              style={[StyleSheet.absoluteFill, { opacity: mainAppFade }]}
              onLayout={onLayoutRootView}
              pointerEvents={landingDismissed ? 'auto' : 'none'}
            >
              {copyToast ? (
                <View style={styles.toast} pointerEvents="none">
                  <View style={styles.toastPill}>
                    <Text style={styles.toastText}>Device ID copied</Text>
                  </View>
                </View>
              ) : null}
              <NavigationContainer>
                <Stack.Navigator
                  id={undefined}
                  initialRouteName={UI_PREVIEW_MODE ? 'PhotoGrocery' : 'Main'}
                  screenOptions={{ headerShown: false }}
                >
                  <Stack.Screen name="Main" component={MainTabs} />
                  <Stack.Group screenOptions={{ presentation: 'modal' }}>
                    <Stack.Screen name="AddFoodChoice" component={AddFoodChoiceScreen} />
                    <Stack.Screen name="AddFood" component={AddFoodScreen} />
                    <Stack.Screen name="SmartAddFood" component={SmartAddFoodScreen} />
                    <Stack.Screen name="PhotoGrocery" component={PhotoGroceryScreen} />
                    <Stack.Screen name="ScanGroceries" component={ScanGroceriesScreen} />
                    <Stack.Screen name="ScanningGroceries" component={ScanningGroceriesScreen} />
                    <Stack.Screen name="DetectionComplete" component={DetectionCompleteScreen} />
                    <Stack.Screen name="ReviewDetectedItems" component={ReviewDetectedItemsScreen} />
                    <Stack.Screen name="EditDetectedItem" component={EditDetectedItemScreen} options={{ presentation: 'modal' }}/>
                    {/* Same form in "add" mode -- see EditDetectedItemScreen. */}
                    <Stack.Screen name="AddMissingItem" component={EditDetectedItemScreen} options={{ presentation: 'modal' }}/>
                    <Stack.Screen name="FoodDetail" component={FoodDetailScreen} />
                    <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
                    <Stack.Screen name="RecipeConsume" component={RecipeConsumeScreen} />
                    <Stack.Screen name="RecordOutcome" component={RecordOutcomeScreen} />
                    <Stack.Screen name="MarkConsumed" component={MarkConsumedScreen} />
                    <Stack.Screen name="MarkWasted" component={MarkWastedScreen} />
                    <Stack.Screen name="WasteRecorded" component={WasteRecordedScreen} />
                  </Stack.Group>
                </Stack.Navigator>
              </NavigationContainer>
            </Animated.View>
          )}

          {/* Landing / restore-prompt overlay -- sits on top until its own
              exit animation reports completion. */}
          {!landingDismissed && (
            <View style={StyleSheet.absoluteFill}>
              {restorePromptId ? (
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
              ) : (
                <LandingScreen
                  appReady={appReady}
                  onGetStarted={startMainAppFadeIn}
                  onExitComplete={() => setLandingDismissed(true)}
                  onFirstPaint={() => SplashScreen.hideAsync()}
                />
              )}
            </View>
          )}
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
