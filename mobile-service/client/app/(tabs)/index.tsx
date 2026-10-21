import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import SectionRenderer from '../../src/components/home/SectionRenderer'
import Spinner from '../../src/components/ui/Spinner'
import { getHome } from '../../src/api/home'

// The storefront home: the admin-configured sections from GET /api/home, rendered like the web's page.
export default function HomeScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: getHome,
    staleTime: 120_000,
  })

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      {isLoading ? (
        <Spinner />
      ) : isError || !data ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-foreground-muted">Couldn't load the store. Pull down to try again.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
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
        </ScrollView>
      )}
    </View>
  )
}
