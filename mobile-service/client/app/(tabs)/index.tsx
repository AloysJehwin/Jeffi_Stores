import { useCallback, useMemo } from 'react'
import { RefreshControl, View, type ListRenderItem } from 'react-native'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { useQuery } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import SectionRenderer from '../../src/components/home/SectionRenderer'
import { HomeScrollContext } from '../../src/components/home/scroll-context'
import { HomeSkeleton, Screen, useBottomInset } from '../../src/ui'
import { getHome } from '../../src/api/home'
import type { HomeSection } from '../../src/types/home'
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

  // Each product_row's position among the rows, for its alternating style.
  const rowIndex = useMemo(() => {
    let n = 0
    return (data?.sections ?? []).map(s => (s.type === 'product_row' ? n++ : n))
  }, [data?.sections])
  const renderSection = useCallback<ListRenderItem<HomeSection>>(
    ({ item, index }) => (data ? <SectionRenderer section={item} data={data.data} rowIndex={rowIndex[index]} /> : null),
    [data, rowIndex]
  )

  // A failed load gets a retry and pull to refresh (Screen's scroll mode), with the generic connection message.
  if (!isLoading && (isError || !data)) {
    return <Screen header={<TopNav />} error onRetry={refetch} refreshing={isRefetching} onRefresh={refetch} />
  }

  return (
    <Screen header={<TopNav />} mode="none" loading={isLoading} skeleton={<View className="flex-1 overflow-hidden"><HomeSkeleton /></View>}>
      {data ? (
        <HomeScrollContext.Provider value={scrollY}>
          {/* Windowed: sections (and their images) mount as they near the screen, not all at once. */}
          <Animated.FlatList
            data={data.sections}
            keyExtractor={s => s.id}
            renderItem={renderSection}
            initialNumToRender={3}
            maxToRenderPerBatch={2}
            windowSize={9}
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: bottomInset }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
            }
          />
        </HomeScrollContext.Provider>
      ) : null}
    </Screen>
  )
}
