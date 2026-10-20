import { useState } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, TextInput, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '../../src/stores/authStore'
import { logout } from '../../src/api/auth'
import { useCartStore } from '../../src/stores/cartStore'
import { useThemeStore } from '../../src/stores/themeStore'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../src/api/client'
import TopNav from '../../src/components/layout/TopNav'

type Tab = 'profile' | 'orders' | 'transactions' | 'addresses' | 'wishlist'

const TABS: { key: Tab; label: string; icon: string; route?: string }[] = [
  { key: 'profile', label: 'Profile', icon: 'person-outline' },
  { key: 'orders', label: 'My Orders', icon: 'bag-outline', route: '/orders' },
  { key: 'transactions', label: 'Transactions', icon: 'receipt-outline', route: '/account/transactions' },
  { key: 'addresses', label: 'Addresses', icon: 'location-outline', route: '/account/addresses' },
  { key: 'wishlist', label: 'Wishlist', icon: 'heart-outline', route: '/(tabs)/wishlist' },
]

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-gray-100 dark:border-[#3f4150]">
      <Text className="text-sm text-gray-500 dark:text-gray-400">{label}</Text>
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right max-w-[60%]" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

export default function AccountScreen() {
  const router = useRouter()
  const { user, clearAuth, setAuth, token } = useAuthStore()
  const { reset: resetCart } = useCartStore()
  const { colorScheme, toggle } = useThemeStore()
  const qc = useQueryClient()

  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [isEditing, setIsEditing] = useState(false)
  const [firstName, setFirstName] = useState(user?.firstName || '')
  const [lastName, setLastName] = useState(user?.lastName || '')
  const [phone, setPhone] = useState((user?.phone || '').replace(/^\+91/, ''))

  const handleLogout = async () => {
    await logout()
    await clearAuth()
    resetCart()
    qc.clear()
  }

  const updateMutation = useMutation({
    mutationFn: () => api('/api/user/profile', {
      method: 'PUT',
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() }),
    }),
    onSuccess: async (data: any) => {
      await setAuth(data.user, token!)
      setIsEditing(false)
      Alert.alert('Success', 'Profile updated successfully.')
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to update profile'),
  })

  const handleTabPress = (tab: typeof TABS[number]) => {
    if (tab.route) {
      router.push(tab.route as any)
    } else {
      setActiveTab(tab.key)
      setIsEditing(false)
    }
  }

  if (!user) {
    return (
      <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
        <TopNav />
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-24 h-24 rounded-full bg-gray-100 dark:bg-[#24252f] items-center justify-center mb-4">
            <Ionicons name="person-outline" size={48} color="#9CA3AF" />
          </View>
          <Text className="text-gray-900 dark:text-gray-100 text-xl font-bold">Welcome Back</Text>
          <Text className="text-gray-400 dark:text-gray-500 text-sm mt-1 text-center">
            Login to your Jeffi Stores account
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/login')}
            className="mt-6 bg-accent-500 py-4 rounded-xl w-full items-center"
          >
            <Text className="text-white font-bold text-base">Sign In</Text>
          </TouchableOpacity>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-4">
            Don&apos;t have an account?{' '}
            <Text className="text-accent-500 font-semibold" onPress={() => router.push('/(auth)/login')}>
              Create one
            </Text>
          </Text>
        </View>
      </View>
    )
  }

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  const displayPhone = user.phone
    ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`)
    : '—'

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Green header — matches website accent-500 */}
        <View className="bg-accent-500 pt-6 pb-14 px-4">
          <Text className="text-white/80 text-sm font-semibold mb-4">My Account</Text>
          <View className="flex-row items-center gap-4">
            <View className="w-16 h-16 rounded-full bg-white/20 items-center justify-center">
              <Text className="text-white text-2xl font-black">
                {user.firstName?.[0]?.toUpperCase() || user.email[0]?.toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xl font-bold text-white" numberOfLines={1}>
                {user.firstName} {user.lastName}
              </Text>
              <Text className="text-sm text-white/70 mt-0.5" numberOfLines={1}>{user.email}</Text>
            </View>
          </View>
        </View>

        {/* Horizontal tab nav — overlapping the header */}
        <View className="mx-4 -mt-8 mb-4 z-10">
          <View className="bg-white dark:bg-[#24252f] rounded-xl shadow-md border border-gray-100 dark:border-[#3f4150] overflow-hidden">
            <View className="flex-row">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.key && !tab.route
                return (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => handleTabPress(tab)}
                    className={`flex-1 items-center py-3 gap-1 border-b-2 ${
                      isActive
                        ? 'border-accent-500'
                        : 'border-transparent'
                    }`}
                  >
                    <Ionicons
                      name={tab.icon as any}
                      size={18}
                      color={isActive ? '#7cb900' : '#9CA3AF'}
                    />
                    <Text
                      className={`text-center font-medium ${isActive ? 'text-accent-600 dark:text-accent-400' : 'text-gray-400 dark:text-gray-500'}`}
                      style={{ fontSize: 9, lineHeight: 13 }}
                      numberOfLines={2}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </View>

        {/* Profile content */}
        <View className="mx-4">
          <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-100 dark:border-[#3f4150] p-4">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-base font-bold text-gray-900 dark:text-gray-100">Profile Information</Text>
              {!isEditing && (
                <TouchableOpacity
                  onPress={() => {
                    setFirstName(user.firstName || '')
                    setLastName(user.lastName || '')
                    setPhone((user.phone || '').replace(/^\+91/, ''))
                    setIsEditing(true)
                  }}
                  className="px-3 py-1 rounded-lg border border-accent-200 dark:border-accent-800"
                >
                  <Text className="text-sm text-accent-600 dark:text-accent-400 font-medium">Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {!isEditing ? (
              <View>
                <InfoRow label="Email" value={user.email} />
                <InfoRow label="First Name" value={user.firstName || '—'} />
                <InfoRow label="Last Name" value={user.lastName || '—'} />
                <InfoRow label="Phone" value={displayPhone} />
                <View className="flex-row items-center justify-between py-3">
                  <Text className="text-sm text-gray-500 dark:text-gray-400">Member Since</Text>
                  <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{memberSince}</Text>
                </View>
              </View>
            ) : (
              <View className="gap-4">
                <View>
                  <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</Text>
                  <View className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 bg-gray-100 dark:bg-[#2e303b]">
                    <Text className="text-gray-400">{user.email}</Text>
                  </View>
                  <Text className="text-xs text-gray-400 mt-1">Email cannot be changed</Text>
                </View>

                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">First Name *</Text>
                    <TextInput
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="First name"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="words"
                      className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f]"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Last Name</Text>
                    <TextInput
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Last name"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="words"
                      className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f]"
                    />
                  </View>
                </View>

                <View>
                  <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Phone Number</Text>
                  <View className="flex-row">
                    <View className="border border-gray-200 dark:border-[#3f4150] border-r-0 rounded-l-xl px-3 py-3 bg-gray-100 dark:bg-[#2e303b] items-center justify-center">
                      <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium">+91</Text>
                    </View>
                    <TextInput
                      value={phone}
                      onChangeText={(v) => setPhone(v.replace(/\D/g, ''))}
                      placeholder="98765 43210"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="phone-pad"
                      maxLength={10}
                      className="flex-1 border border-gray-200 dark:border-[#3f4150] rounded-r-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#24252f]"
                    />
                  </View>
                </View>

                <View className="flex-row gap-3 pt-1">
                  <TouchableOpacity
                    onPress={() => updateMutation.mutate()}
                    disabled={updateMutation.isPending}
                    className="flex-1 py-3 bg-accent-500 rounded-xl items-center disabled:opacity-50"
                  >
                    <Text className="text-white font-semibold">
                      {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setIsEditing(false)}
                    disabled={updateMutation.isPending}
                    className="flex-1 py-3 bg-gray-100 dark:bg-[#2e303b] rounded-xl items-center"
                  >
                    <Text className="text-gray-600 dark:text-gray-300 font-semibold">Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Dark mode toggle */}
          <View className="mt-3 bg-white dark:bg-[#24252f] rounded-xl overflow-hidden border border-gray-100 dark:border-[#3f4150]">
            <View className="flex-row items-center px-4 py-4">
              <View className="w-9 h-9 rounded-full bg-gray-100 dark:bg-[#2e303b] items-center justify-center mr-3">
                <Ionicons name="moon-outline" size={18} color="#f59e0b" />
              </View>
              <Text className="flex-1 text-gray-800 dark:text-gray-200 font-medium">Dark Mode</Text>
              <Switch
                value={colorScheme === 'dark'}
                onValueChange={toggle}
                trackColor={{ false: '#E5E7EB', true: '#7cb900' }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          {/* Sign out */}
          <TouchableOpacity
            onPress={handleLogout}
            className="mt-3 mb-8 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800 px-4 py-4 flex-row items-center justify-center gap-2"
          >
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            <Text className="text-red-600 font-semibold">Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}
