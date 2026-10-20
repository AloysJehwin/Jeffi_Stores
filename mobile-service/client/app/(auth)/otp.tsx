import { useState, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { loginWithOtp } from '../../src/api/auth'
import { useAuthStore } from '../../src/stores/authStore'

export default function OtpScreen() {
  const router = useRouter()
  const { email } = useLocalSearchParams<{ email: string }>()
  const { setAuth } = useAuthStore()
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<TextInput>(null)

  const handleVerify = async () => {
    if (otp.length !== 6) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit OTP sent to your email.')
      return
    }
    setLoading(true)
    try {
      const result = await loginWithOtp(email, otp)
      if (result.isNewUser) {
        router.replace({ pathname: '/(auth)/signup', params: { email } })
        return
      }
      if (!result.user) throw new Error('Login failed')
      await setAuth(result.user, result.token)
      router.dismissAll()
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Invalid OTP. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1a1b23]">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <TouchableOpacity onPress={() => router.back()} className="px-4 pt-4 flex-row items-center gap-1">
          <Ionicons name="arrow-back" size={20} color="#6B7280" />
          <Text className="text-gray-500">Back</Text>
        </TouchableOpacity>

        <View className="flex-1 px-6 pt-8">
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Enter OTP</Text>
          <Text className="text-gray-500 dark:text-gray-400 mb-8">
            We sent a 6-digit code to {email}
          </Text>

          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">One-Time Password</Text>
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-4 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f] text-2xl text-center tracking-[12px] mb-6"
            onSubmitEditing={handleVerify}
          />

          <TouchableOpacity
            onPress={handleVerify}
            disabled={loading || otp.length !== 6}
            className="bg-accent-500 py-4 rounded-xl items-center disabled:opacity-50"
          >
            <Text className="text-white font-bold text-base">
              {loading ? 'Verifying...' : 'Verify OTP'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
