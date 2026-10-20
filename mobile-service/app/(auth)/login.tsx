import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { sendOtp } from '../../src/api/auth'

export default function LoginScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSendOtp = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      await sendOtp(trimmed)
      router.push({ pathname: '/(auth)/otp', params: { email: trimmed } })
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send OTP. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1a1b23]">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <TouchableOpacity onPress={() => router.back()} className="px-4 pt-4">
          <Ionicons name="close" size={24} color="#6B7280" />
        </TouchableOpacity>

        <View className="flex-1 px-6 pt-8">
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Sign In</Text>
          <Text className="text-gray-500 dark:text-gray-400 mb-8">
            Enter your email to receive a one-time password
          </Text>

          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email Address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9CA3AF"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-4 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f] text-base mb-6"
            onSubmitEditing={handleSendOtp}
            returnKeyType="send"
          />

          <TouchableOpacity
            onPress={handleSendOtp}
            disabled={loading || email.trim().length < 5}
            className="bg-accent-500 py-4 rounded-xl items-center disabled:opacity-50"
          >
            <Text className="text-white font-bold text-base">
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </Text>
          </TouchableOpacity>

          <View className="flex-row items-center my-6">
            <View className="flex-1 h-px bg-gray-200 dark:bg-[#3f4150]" />
            <Text className="mx-4 text-gray-400 text-sm">or</Text>
            <View className="flex-1 h-px bg-gray-200 dark:bg-[#3f4150]" />
          </View>

          <Text className="text-center text-gray-500 dark:text-gray-400 text-sm">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
