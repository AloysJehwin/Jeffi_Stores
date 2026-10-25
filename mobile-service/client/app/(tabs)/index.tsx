import { RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { useQuery } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import SectionRenderer from '../../src/components/home/SectionRenderer'
import { HomeScrollContext } from '../../src/components/home/scroll-context'
import { HomeSkeleton } from '../../src/ui'
import { getHome } from '../../src/api/home'

// The storefront home: the admin-configured sections from GET /api/home, rendered like the web's page.
export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: getHome,
    staleTime: 120_000,
  })
  // Shared with sections that animate as they scroll into view (ProductSpotlight).
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y
  })

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      {isLoading ? (
        <View className="flex-1 overflow-hidden">
          <HomeSkeleton />
        </View>
      ) : isError || !data ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-foreground-muted">Couldn't load the store. Pull down to try again.</Text>
        </View>
      ) : (
        <HomeScrollContext.Provider value={scrollY}>
          <Animated.ScrollView
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom }}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          >
            {data.sections.map((section, i) => (
              <SectionRenderer
                key={section.id}
                section={section}
                data={data.data}
                rowIndex={data.sections.slice(0, i).filter(s => s.type === 'product_row').length}
              />
            ))}
          </Animated.ScrollView>
        </HomeScrollContext.Provider>
      )}
    </View>
  )
}
