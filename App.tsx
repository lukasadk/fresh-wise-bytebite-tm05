import React, { useCallback } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import PantryScreen from './src/screens/PantryScreen';
import UseFirstScreen from './src/screens/UseFirstScreen';
import AddFoodScreen from './src/screens/AddFoodScreen';
import FoodDetailScreen from './src/screens/FoodDetailScreen';
import RecordOutcomeScreen from './src/screens/RecordOutcomeScreen';
import MarkConsumedScreen from './src/screens/MarkConsumedScreen';
import MarkWastedScreen from './src/screens/MarkWastedScreen';
import WasteRecordedScreen from './src/screens/WasteRecordedScreen';
import BottomNav from './src/components/BottomNav';
import { colors } from './src/theme/theme';

SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Placeholder screen for the flow not yet built from Figma — swap in the real screen once PNGs come in.
function RecipesScreen() {
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}

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

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
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
  );
}