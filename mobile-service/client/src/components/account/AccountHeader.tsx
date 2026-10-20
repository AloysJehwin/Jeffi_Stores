import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../stores/authStore'
import TopNav from '../layout/TopNav'

type Tab = 'profile' | 'orders' | 'transactions' | 'addresses' | 'wishlist'

const TABS: { key: Tab; label: string; icon: string; route: string }[] = [
  { key: 'profile', label: 'Profile', icon: 'person-outline', route: '/(tabs)/account' },
  { key: 'orders', label: 'My Orders', icon: 'bag-outline', route: '/orders' },
  { key: 'transactions', label: 'Transactions', icon: 'receipt-outline', route: '/account/transactions' },
  { key: 'addresses', label: 'Addresses', icon: 'location-outline', route: '/account/addresses' },
  { key: 'wishlist', label: 'Wishlist', icon: 'heart-outline', route: '/(tabs)/wishlist' },
]

export default function AccountHeader({ activeTab }: { activeTab: Tab }) {
  const router = useRouter()
  const { user } = useAuthStore()

  return (
    <>
      <TopNav />

      {/* Green header */}
      <View className="bg-accent-500 pt-6 pb-14 px-4">
        <Text className="text-white/80 text-sm font-semibold mb-4">My Account</Text>
        <View className="flex-row items-center gap-4">
          <View className="w-16 h-16 rounded-full bg-white/20 items-center justify-center">
            <Text className="text-white text-2xl font-black">
              {user?.firstName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-xl font-bold text-white" numberOfLines={1}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text className="text-sm text-white/70 mt-0.5" numberOfLines={1}>{user?.email}</Text>
          </View>
        </View>
      </View>

      {/* Horizontal tab nav overlapping the header */}
      <View className="mx-4 -mt-8 mb-4 z-10">
        <View className="bg-white dark:bg-[#24252f] rounded-xl shadow-md border border-gray-100 dark:border-[#3f4150] overflow-hidden">
          <View className="flex-row">
            {TABS.map((tab) => {
              const isActive = tab.key === activeTab
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => router.push(tab.route as any)}
                  className={`flex-1 items-center py-3 gap-1 border-b-2 ${isActive ? 'border-accent-500' : 'border-transparent'}`}
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
    </>
  )
}
