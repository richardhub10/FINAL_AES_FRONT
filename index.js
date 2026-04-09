/**
 * Entry point for the Expo/React Native app.
 *
 * This file is intentionally small:
 * - Imports the root `App` component
 * - Registers it with Expo so it runs in Expo Go and in a native build
 */

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
