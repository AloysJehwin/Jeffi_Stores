import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { signup } from '../../src/api/auth'
import { useAuthStore } from '../../src/stores/authStore'

export default function SignupScreen() {
  const router = useRouter()
  const { email } = useLocalSearchParams<{ email: string }>()
  const { setAuth } = useAuthStore()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignup = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Required', 'Please enter your first and last name.')
      return
    }
    setLoading(true)
    try {
      const result = await signup({ email, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() || undefined })
      await setAuth(result.user, result.token)
      router.dismissAll()
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1a1b23]">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <View className="flex-1 px-6 pt-8">
            <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Complete Profile
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 mb-8">
              Just a few details to get you started
            </Text>

            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</Text>
            <View className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 mb-4 bg-gray-100 dark:bg-[#2e303b]">
              <Text className="text-gray-500">{email}</Text>
            </View>

            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name *</Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
              className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-4 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f] text-base mb-4"
            />

            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name *</Text>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
              className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-4 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f] text-base mb-4"
            />

            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone (optional)</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 98765 43210"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-4 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f] text-base mb-6"
            />

            <TouchableOpacity
              onPress={handleSignup}
              disabled={loading || !firstName.trim() || !lastName.trim()}
              className="bg-accent-500 py-4 rounded-xl items-center disabled:opacity-50"
            >
              <Text className="text-white font-bold text-base">
                {loading ? 'Creating account...' : 'Create Account'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
