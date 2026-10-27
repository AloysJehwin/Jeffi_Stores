import { Stack } from 'expo-router'

// The sheet in AuthScreen does the sliding; the screens themselves only cross-fade.
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="business-login" />
      <Stack.Screen name="business-signup" />
    </Stack>
  )
}
