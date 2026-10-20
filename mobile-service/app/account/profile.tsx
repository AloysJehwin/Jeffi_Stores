import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/api/client'
import { useAuthStore } from '../../src/stores/authStore'

export default function ProfileScreen() {
  const router = useRouter()
  const { user, setAuth, token } = useAuthStore()

  const [firstName, setFirstName] = useState(user?.firstName || '')
  const [lastName, setLastName] = useState(user?.lastName || '')
  const [phone, setPhone] = useState(user?.phone || '')

  const updateMutation = useMutation({
    mutationFn: () => api('/api/user/profile', {
      method: 'PUT',
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() }),
    }),
    onSuccess: async (data: any) => {
      await setAuth(data.user, token!)
      Alert.alert('Success', 'Profile updated successfully.')
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to update profile'),
  })

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100 dark:border-[#3f4150] bg-white dark:bg-[#24252f]">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#6B7280" />
        </TouchableOpacity>
        <Text className="flex-1 text-center font-semibold text-gray-900 dark:text-gray-100">Edit Profile</Text>
        <View className="w-6" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 gap-4">
          <View>
            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</Text>
            <View className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 bg-gray-100 dark:bg-[#2e303b]">
              <Text className="text-gray-500">{user?.email}</Text>
            </View>
          </View>
          <View>
            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
              className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f]"
            />
          </View>
          <View>
            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</Text>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
              className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f]"
            />
          </View>
          <View>
            <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 98765 43210"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="border border-gray-300 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f]"
            />
          </View>
          <TouchableOpacity
            onPress={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="bg-accent-500 py-4 rounded-xl items-center disabled:opacity-50 mt-2"
          >
            <Text className="text-white font-bold">
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
