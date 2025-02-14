// AppRoot.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RecorderScreen from './App';           // 録音画面 (RecorderScreen)
import HistoryScreen from './HistoryScreen';    // 履歴画面

const Stack = createNativeStackNavigator();

export default function AppRoot() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Recorder">
        <Stack.Screen
          name="Recorder"
          component={RecorderScreen}
          options={{ title: 'Lesson Recorder' }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{ title: 'Session History' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}



