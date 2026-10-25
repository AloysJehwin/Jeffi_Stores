import { RefreshControl, View } from 'react-native'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { useQuery } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import SectionRenderer from '../../src/components/home/SectionRenderer'
import { HomeScrollContext } from '../../src/components/home/scroll-context'
import { HomeSkeleton, Screen, useBottomInset } from '../../src/ui'
import { getHome } from '../../src/api/home'
import { useTokens } from '../../src/theme'

// The storefront home: the admin-configured sections from GET /api/home, rendered like the web's page.
export default function HomeScreen() {
  const bottomInset = useBottomInset(0)
  const t = useTokens()
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

  // A failed load gets a retry and pull to refresh (Screen's scroll mode), with the generic connection message.
  if (!isLoading && (isError || !data)) {
    return <Screen header={<TopNav />} error onRetry={refetch} refreshing={isRefetching} onRefresh={refetch} />
  }

  return (
    <Screen header={<TopNav />} mode="none" loading={isLoading} skeleton={<View className="flex-1 overflow-hidden"><HomeSkeleton /></View>}>
      {data ? (
        <HomeScrollContext.Provider value={scrollY}>
          <Animated.ScrollView
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: bottomInset }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
            }
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
      ) : null}
    </Screen>
  )
}
