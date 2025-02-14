// App.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import RecorderScreen from './RecorderScreen';
import HistoryScreen from './HistoryScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Recorder"
        screenOptions={{
          // 画面遷移アニメを無効化し、チラつきを抑える
          animation: 'none',
          headerShown: false
        }}
      >
        <Stack.Screen
          name="Recorder"
          component={RecorderScreen}
          options={{
            headerShown: false,
            // 前画面デタッチ & アンマウントで、さらにチラつき低減
            detachPreviousScreen: true,
            unmountOnBlur: true,
            // iOSでは'transparentModal'などを指定すると重なりが軽減
            presentation: 'transparentModal'
          }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{
            headerShown: false,
            detachPreviousScreen: true,
            unmountOnBlur: true,
            presentation: 'transparentModal'
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}





















